import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { pool, zk } from "@soteria/sdk";
import { SERVER } from "./soteria";

// Trusted-setup artifacts produced by scripts/setup-pool.sh, served statically.
const WITHDRAW_WASM = "/withdraw.wasm";
const WITHDRAW_ZKEY = "/withdraw_final.zkey";

export type Note = ReturnType<typeof pool.randomNote>;

export interface PoolState {
  poolId: number;
  denomination: string;
  deposits: string[];
  association: string[];
  depositRoot: string | null;
  associationRoot: string | null;
  anonymitySet: number;
  minAnonymitySet: number;
}

// Below this the crowd is too small to meaningfully hide in — surface a warning
// even if the operator's hard floor is lower.
export const SAFE_ANONYMITY_SET = 10;

export async function fetchPool(poolId: number): Promise<PoolState> {
  const res = await fetch(`${SERVER}/pools/${poolId}`);
  if (!res.ok) throw new Error(`pool ${poolId} not found`);
  return res.json();
}

// ── Claim links: wrap a note so the deposit IS the payment ──

/** Shareable link carrying a note; the recipient opens it and claims. */
export function claimLink(note: Note): string {
  const base = typeof location !== "undefined" ? location.origin + location.pathname : "";
  return `${base}?claim=${encodeURIComponent(pool.encodeNote(note))}#claim`;
}

/** Accept either a full claim link or a bare note string, return the note string. */
export function extractClaimCode(input: string): string {
  const s = input.trim();
  const m = s.match(/[?&]claim=([^&#\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

/**
 * Deposit one denomination into a pool. Builds a fresh note, sends the deposit
 * transaction from the user's wallet, then records the commitment with the
 * operator so it gets inserted into the tree. Returns the note backup string —
 * the user MUST save it; it is the only way to withdraw.
 */
export async function deposit(opts: {
  connection: Connection;
  depositor: PublicKey;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  poolId: number;
}): Promise<{ note: Note; backup: string; signature: string }> {
  const { connection, depositor, sendTransaction, poolId } = opts;

  const note = pool.randomNote(poolId);
  const commitment = await pool.commitment(note);

  const ix = pool.depositInstruction(depositor, poolId, commitment);
  const tx = new Transaction().add(ix);
  tx.feePayer = depositor;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(signature, "confirmed");

  // Notify the operator so the commitment enters the deposit tree.
  const res = await fetch(`${SERVER}/pools/${poolId}/commitments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commitment: commitment.toString() }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`operator rejected the commitment: ${err.error ?? res.status}`);
  }

  return { note, backup: pool.encodeNote(note), signature };
}

async function rebuildTree(commitments: string[]): Promise<zk.PoseidonMerkleTree> {
  const tree = await zk.PoseidonMerkleTree.create(20);
  for (const c of commitments) tree.insert(BigInt(c));
  return tree;
}

/**
 * Withdraw a note to a fresh recipient. Generates the ZK proof in-browser and
 * submits it through the relayer, so the withdrawer's own wallet never appears
 * on-chain. `fee` (lamports) is paid to the relayer out of the denomination.
 */
export async function withdraw(opts: {
  backup: string;
  recipient: PublicKey;
  fee: bigint;
}): Promise<{ signature: string }> {
  const note = pool.decodeNote(extractClaimCode(opts.backup));
  const poolId = Number(note.poolId);
  const state = await fetchPool(poolId);

  const commitment = (await pool.commitment(note)).toString();
  const depositLeafIndex = state.deposits.indexOf(commitment);
  if (depositLeafIndex < 0) {
    throw new Error("note's deposit is not in the pool yet — wait for the operator");
  }
  const assocLeafIndex = state.association.indexOf(commitment);
  if (assocLeafIndex < 0) {
    throw new Error("note is not in the approved association set");
  }

  const depositTree = await rebuildTree(state.deposits);
  const assocTree = await rebuildTree(state.association);

  const raw = await pool.proveWithdrawRaw(
    {
      note,
      depositTree,
      depositLeafIndex,
      assocTree,
      assocLeafIndex,
      recipient: opts.recipient,
      fee: opts.fee,
    },
    WITHDRAW_WASM,
    WITHDRAW_ZKEY
  );

  const res = await fetch(`${SERVER}/pools/${poolId}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: opts.recipient.toBase58(),
      fee: opts.fee.toString(),
      proof: raw.proof,
      publicSignals: raw.publicSignals,
    }),
  });
  const out = await res.json();
  if (!res.ok || !out.ok) {
    throw new Error(out.error ?? `withdraw failed (${res.status})`);
  }
  return { signature: out.signature };
}
