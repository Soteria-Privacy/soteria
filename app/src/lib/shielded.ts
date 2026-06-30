import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { shielded, zk } from "@soteria1/sdk";
import { SERVER } from "./soteria";

const SHIELDED_ID = Number(import.meta.env.VITE_SOTERIA_SHIELDED_ID ?? 0);
const TX_WASM = "/transaction.wasm";
const TX_ZKEY = "/transaction_final.zkey";
const CU = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

export type Identity = Awaited<ReturnType<typeof shielded.deriveShieldedKeypair>>;
export type OwnedNote = Awaited<ReturnType<typeof shielded.scanOutputs>>[number];

export const SHIELDED_DERIVE_MESSAGE = new TextEncoder().encode(
  "Soteria shielded payments\n\nSign to derive your shielded keys. " +
    "This signature never leaves your device."
);

export async function deriveIdentity(
  signMessage: (m: Uint8Array) => Promise<Uint8Array>
): Promise<Identity> {
  return shielded.deriveShieldedKeypair(await signMessage(SHIELDED_DERIVE_MESSAGE));
}

export const myAddress = (id: Identity) => shielded.encodeShieldedAddress(id);

interface State {
  root: string | null;
  relayer: string | null;
  records: { commitment: string; encryptedSecret: string; leafIndex: number }[];
  spentNullifiers: string[];
}

export async function fetchState(): Promise<State> {
  const res = await fetch(`${SERVER}/shielded/${SHIELDED_ID}`);
  if (!res.ok) throw new Error("shielded pool not found");
  return res.json();
}

const be32 = (v: bigint) => {
  const o: number[] = new Array(32).fill(0);
  let x = v;
  for (let i = 31; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; }
  return o;
};
const nfKey = (n: bigint) => be32(n).join(",");

/** Owned, unspent notes (scan every record, drop those whose nullifier is spent). */
export async function myNotes(id: Identity): Promise<OwnedNote[]> {
  const st = await fetchState();
  const owned = await shielded.scanOutputs(
    st.records.map((r) => ({ commitment: BigInt(r.commitment), encryptedSecret: r.encryptedSecret, leafIndex: r.leafIndex })),
    id
  );
  const spent = new Set(st.spentNullifiers);
  return owned.filter((n) => !spent.has(nfKey(n.nullifier)));
}

export const balance = (notes: OwnedNote[]): bigint => shielded.balance(notes);

async function rebuildTree(records: State["records"]): Promise<zk.PoseidonMerkleTree> {
  const sorted = [...records].sort((a, b) => a.leafIndex - b.leafIndex);
  const tree = await zk.PoseidonMerkleTree.create(20);
  tree.insertMany(sorted.map((r) => BigInt(r.commitment)));
  return tree;
}

// Greedily pick ≤2 notes covering `target` (the circuit takes 2 inputs).
function selectInputs(notes: OwnedNote[], target: bigint): OwnedNote[] {
  const sorted = [...notes].sort((a, b) => (b.amount > a.amount ? 1 : -1));
  const picked: OwnedNote[] = [];
  let sum = 0n;
  for (const n of sorted) {
    if (sum >= target || picked.length === 2) break;
    picked.push(n); sum += n.amount;
  }
  if (sum < target) {
    throw new Error("amount exceeds your two largest notes — receive/consolidate more first");
  }
  return picked;
}

// The Shielded account's current published root, read straight from chain.
// Layout after the 8-byte discriminator: authority(32) shielded_id(8) depth(1)
// num_commitments(8) root_count(8 @57) current_root_index(4 @65) roots(32×32 @69).
async function currentOnchainRoot(connection: Connection): Promise<bigint> {
  const info = await connection.getAccountInfo(shielded.shieldedPda(SHIELDED_ID));
  if (!info) return 0n;
  const d = info.data;
  const rootCount = d.readBigUInt64LE(57);
  if (rootCount === 0n) return 0n;
  const off = 69 + d.readUInt32LE(65) * 32;
  let v = 0n;
  for (let i = 0; i < 32; i++) v = (v << 8n) | BigInt(d[off + i]);
  return v;
}

/** Deposit any amount (wallet-signed: the depositor funds the vault).
 *  The wallet only SIGNS; we broadcast via our own devnet connection, so a
 *  wallet whose network/RPC differs (Phantom's "Internal error") can't break it. */
export async function deposit(opts: {
  connection: Connection;
  wallet: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  id: Identity;
  amount: bigint;
}): Promise<{ signature: string }> {
  const { connection, wallet, signTransaction, id, amount } = opts;
  // Use the CURRENT published root from chain (deposits have only dummy inputs,
  // so the root isn't checked by the circuit — only that it's a known on-chain
  // root). Reading it from chain makes deposits work even if the operator's
  // mirror is stale or empty.
  const root = await currentOnchainRoot(connection);

  const tx = await shielded.buildTransaction({
    inputs: [],
    outputs: [{ note: shielded.newNote(amount, id.publicKey), encPub: id.encPub }],
    spendKeypair: id, extAmount: amount, fee: 0n,
    recipient: wallet, relayer: wallet, root, wasmPath: TX_WASM, zkeyPath: TX_ZKEY,
  });

  const ix = shielded.transactInstruction({
    shieldedId: SHIELDED_ID, signer: wallet, recipient: wallet, relayer: wallet, tx, extAmount: amount, fee: 0n,
  });
  const transaction = new Transaction().add(CU, ix);
  transaction.feePayer = wallet;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  const signed = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

  await post(`/shielded/${SHIELDED_ID}/deposit-notify`, {
    signature,
    commitments: tx.outputCommitments.map(String),
    encryptedSecrets: tx.encryptedSecrets,
    nullifiers: [tx.publicInputs[3], tx.publicInputs[4]],
  });
  return { signature };
}

async function relayTx(opts: {
  id: Identity;
  amount: bigint;
  fee: bigint;
  extAmount: bigint;
  payRecipientPub: bigint | null; // shielded payee (internal transfer) or null (withdraw)
  payRecipientEnc: Uint8Array | null;
  solRecipient: PublicKey; // on-chain payout dest (withdraw) or the relayer (transfer)
}): Promise<{ signature: string }> {
  const { id, amount, fee, extAmount, payRecipientPub, payRecipientEnc, solRecipient } = opts;
  const st = await fetchState();
  if (!st.relayer) throw new Error("relayer not configured");
  const relayer = new PublicKey(st.relayer);

  const notes = await myNotes(id);
  const selected = selectInputs(notes, amount + fee);
  const inSum = selected.reduce((s, n) => s + n.amount, 0n);
  const change = inSum - amount - fee;

  const tree = await rebuildTree(st.records);
  const inputs = selected.map((n) => {
    const p = tree.proof(n.leafIndex);
    return { note: { amount: n.amount, pubkey: n.pubkey, blinding: n.blinding }, pathElements: p.pathElements, pathIndices: p.pathIndices };
  });

  const outputs = [];
  if (payRecipientPub !== null && payRecipientEnc) {
    outputs.push({ note: shielded.newNote(amount, payRecipientPub), encPub: payRecipientEnc });
  }
  outputs.push({ note: shielded.newNote(change, id.publicKey), encPub: id.encPub });

  const tx = await shielded.buildTransaction({
    inputs, outputs, spendKeypair: id, extAmount, fee,
    recipient: solRecipient, relayer, root: BigInt(st.root ?? "0"),
    wasmPath: TX_WASM, zkeyPath: TX_ZKEY,
  });

  const out = await post(`/shielded/${SHIELDED_ID}/relay`, {
    proof: { proofA: tx.proofA, proofB: tx.proofB, proofC: tx.proofC, publicInputs: tx.publicInputs, nullifiers: [tx.publicInputs[3], tx.publicInputs[4]] },
    extAmount: extAmount.toString(),
    fee: fee.toString(),
    recipient: solRecipient.toBase58(),
    outputs: { commitments: tx.outputCommitments.map(String), encryptedSecrets: tx.encryptedSecrets },
  });
  return { signature: out.signature };
}

// ── Auto-consolidation ──────────────────────────────────────────────────────
// The circuit spends at most 2 notes per tx, so a single pay/withdraw can only
// move your two largest notes. To let users move their *whole* balance in one
// action, we transparently merge notes (self-transfers, two-into-one) until the
// two largest cover the target, then do the real send. Each step is its own
// relayed tx + proof, so we report progress.

export type SpendPhase = "consolidating" | "sending";
export interface SpendProgress {
  phase: SpendPhase;
  step: number; // 1-based
  total: number; // consolidation steps + final send
}

const sortedAmounts = (notes: OwnedNote[]) =>
  notes.map((n) => n.amount).sort((a, b) => (b > a ? 1 : -1));

const topTwo = (amts: bigint[]) => (amts[0] ?? 0n) + (amts[1] ?? 0n);

/** Most you can send in one action after merging everything down (change → 0).
 *  Each of the (N−1) merge/send steps burns one `fee`, so subtract them. */
export function maxSpendable(notes: OwnedNote[], fee: bigint): bigint {
  const live = notes.filter((n) => n.amount > 0n);
  if (live.length === 0) return 0n;
  const total = live.reduce((s, n) => s + n.amount, 0n);
  const cost = BigInt(Math.max(1, live.length - 1)) * fee;
  return total > cost ? total - cost : 0n;
}

/** How many two-into-one merges are needed before the two largest cover target,
 *  or null if the balance can't reach it even fully consolidated. */
function mergesNeeded(notes: OwnedNote[], target: bigint, fee: bigint): number | null {
  const amts = sortedAmounts(notes);
  let merges = 0;
  while (topTwo(amts) < target) {
    if (amts.length < 3) return null;
    const merged = amts[0] + amts[1] - fee;
    amts.splice(0, 2);
    let i = 0;
    while (i < amts.length && amts[i] > merged) i++;
    amts.splice(i, 0, merged);
    merges++;
  }
  return merges;
}

/** Self-transfer of `amount` (two-into-one merge), no nested consolidation. */
async function internalTransfer(id: Identity, toAddress: string, amount: bigint, fee: bigint) {
  const dest = shielded.decodeShieldedAddress(toAddress);
  const st = await fetchState();
  const relayer = new PublicKey(st.relayer!);
  return relayTx({
    id, amount, fee, extAmount: 0n,
    payRecipientPub: dest.publicKey, payRecipientEnc: dest.encPub, solRecipient: relayer,
  });
}

/** Merge notes until the two largest cover `target`, reporting each step. */
async function consolidateForTarget(
  id: Identity,
  target: bigint,
  fee: bigint,
  onProgress?: (p: SpendProgress) => void
): Promise<void> {
  const planned = mergesNeeded(await myNotes(id), target, fee);
  if (planned === null) {
    const have = balance(await myNotes(id));
    throw new Error(
      have < target
        ? "amount exceeds your shielded balance"
        : "amount exceeds your balance after fees — try a little less"
    );
  }
  const total = planned + 1; // + the final send
  for (let step = 0; step < planned; step++) {
    const notes = await myNotes(id);
    if (topTwo(sortedAmounts(notes)) >= target) break;
    const two = [...notes].sort((a, b) => (b.amount > a.amount ? 1 : -1));
    onProgress?.({ phase: "consolidating", step: step + 1, total });
    await internalTransfer(id, myAddress(id), two[0].amount + two[1].amount - fee, fee);
  }
  onProgress?.({ phase: "sending", step: total, total });
}

/** Pay any amount to a shielded address (internal transfer, relayed, with change).
 *  Auto-consolidates first so amounts larger than your two biggest notes work. */
export async function pay(opts: {
  id: Identity; toAddress: string; amount: bigint; fee: bigint;
  onProgress?: (p: SpendProgress) => void;
}) {
  await consolidateForTarget(opts.id, opts.amount + opts.fee, opts.fee, opts.onProgress);
  return internalTransfer(opts.id, opts.toAddress, opts.amount, opts.fee);
}

/** Withdraw any amount to a regular Solana address (relayed).
 *  Auto-consolidates first so amounts larger than your two biggest notes work. */
export async function withdraw(opts: {
  id: Identity; toSolAddress: string; amount: bigint; fee: bigint;
  onProgress?: (p: SpendProgress) => void;
}) {
  await consolidateForTarget(opts.id, opts.amount + opts.fee, opts.fee, opts.onProgress);
  return relayTx({
    id: opts.id, amount: opts.amount, fee: opts.fee, extAmount: -opts.amount,
    payRecipientPub: null, payRecipientEnc: null, solRecipient: new PublicKey(opts.toSolAddress),
  });
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${SERVER}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `request failed (${res.status})`);
  return json;
}
