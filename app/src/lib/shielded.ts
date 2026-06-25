import {
  Connection,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { shielded, zk } from "@soteria/sdk";
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

/** Deposit any amount (wallet-signed: the depositor funds the vault). */
export async function deposit(opts: {
  connection: Connection;
  wallet: PublicKey;
  sendTransaction: (tx: Transaction, c: Connection) => Promise<string>;
  id: Identity;
  amount: bigint;
}): Promise<{ signature: string }> {
  const { connection, wallet, sendTransaction, id, amount } = opts;
  const st = await fetchState();
  const root = st.root ? BigInt(st.root) : 0n;

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
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await sendTransaction(transaction, connection);
  await connection.confirmTransaction(signature, "confirmed");

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

/** Pay any amount to a shielded address (internal transfer, relayed, with change). */
export async function pay(opts: { id: Identity; toAddress: string; amount: bigint; fee: bigint }) {
  const dest = shielded.decodeShieldedAddress(opts.toAddress);
  const st = await fetchState();
  const relayer = new PublicKey(st.relayer!);
  return relayTx({
    id: opts.id, amount: opts.amount, fee: opts.fee, extAmount: 0n,
    payRecipientPub: dest.publicKey, payRecipientEnc: dest.encPub, solRecipient: relayer,
  });
}

/** Withdraw any amount to a regular Solana address (relayed). */
export async function withdraw(opts: { id: Identity; toSolAddress: string; amount: bigint; fee: bigint }) {
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
