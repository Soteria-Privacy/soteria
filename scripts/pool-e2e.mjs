// End-to-end privacy-pool test against a local validator + running server.
// Proves the full path: create pool -> deposit -> operator publishes roots ->
// ZK withdraw to a fresh recipient via the relayer -> deposit and withdrawal
// share NO on-chain address (unlinkable).
//
//   node scripts/pool-e2e.mjs
import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { pool, zk } from "@soteria/sdk";
import { config as dotenv } from "dotenv";

dotenv({ path: "server/.env" });

const SERVER = process.env.SERVER ?? "http://127.0.0.1:8787";
const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const API_KEY = process.env.ADMIN_API_KEY;
const POOL_ID = Number(process.env.POOL_ID ?? 0);
const DENOM = 100_000_000; // 0.1 SOL
const FEE = 5000n;
const WASM = "circuits/build/withdraw_js/withdraw.wasm";
const ZKEY = "circuits/build/withdraw_final.zkey";

const conn = new Connection(RPC, "confirmed");
const j = (label) => async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label}: ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const post = (path, body, admin = false) =>
  fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(admin ? { "x-api-key": API_KEY } : {}),
    },
    body: JSON.stringify(body),
  }).then(j(`POST ${path}`));

async function rebuild(commitments) {
  const t = await zk.PoseidonMerkleTree.create(20);
  for (const c of commitments) t.insert(BigInt(c));
  return t;
}

async function main() {
  console.log("→ creating pool", POOL_ID, "denomination", DENOM / LAMPORTS_PER_SOL, "SOL");
  await post("/pools", { poolId: POOL_ID, denomination: String(DENOM) }, true).catch((e) => {
    if (!/duplicate/.test(String(e))) throw e;
    console.log("  (pool already exists, reusing)");
  });

  // ── DEPOSIT ──
  const depositor = Keypair.generate();
  const sig = await conn.requestAirdrop(depositor.publicKey, 1 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");

  const note = pool.randomNote(POOL_ID);
  const commitment = await pool.commitment(note);
  const ix = pool.depositInstruction(depositor.publicKey, POOL_ID, commitment);
  const depositTx = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [depositor], {
    commitment: "confirmed",
  });
  console.log("→ deposit tx", depositTx, "  (signer:", depositor.publicKey.toBase58() + ")");

  await post(`/pools/${POOL_ID}/commitments`, { commitment: commitment.toString() });
  await post(`/pools/${POOL_ID}/publish`, {}, true);
  await post(`/pools/${POOL_ID}/association`, {}, true); // non-gated: assoc = all deposits
  console.log("→ operator published deposit + association roots");

  if (process.env.SEED_ONLY) {
    console.log("→ SEED_ONLY: deposited, skipping withdraw");
    process.exit(0);
  }

  // ── WITHDRAW ──
  const recipient = Keypair.generate().publicKey; // fresh, never linked
  const state = await fetch(`${SERVER}/pools/${POOL_ID}`).then(j("GET pool"));
  const cm = commitment.toString();
  const depositLeafIndex = state.deposits.indexOf(cm);
  const assocLeafIndex = state.association.indexOf(cm);

  const depositTree = await rebuild(state.deposits);
  const assocTree = await rebuild(state.association);
  console.log("→ generating ZK proof (anonymity set size:", state.deposits.length + ")");

  const raw = await pool.proveWithdrawRaw(
    { note, depositTree, depositLeafIndex, assocTree, assocLeafIndex, recipient, fee: FEE },
    WASM,
    ZKEY
  );

  const before = await conn.getBalance(recipient);
  const out = await post(`/pools/${POOL_ID}/withdraw`, {
    recipient: recipient.toBase58(),
    fee: FEE.toString(),
    proof: raw.proof,
    publicSignals: raw.publicSignals,
  });
  await conn.confirmTransaction(out.signature, "confirmed");
  const after = await conn.getBalance(recipient);
  console.log("→ withdraw tx", out.signature);

  // ── ASSERTIONS ──
  const received = after - before;
  const expected = DENOM - Number(FEE);
  console.log("\nRESULT");
  console.log("  recipient received :", received / LAMPORTS_PER_SOL, "SOL", received === expected ? "✓" : "✗ EXPECTED " + expected);

  const depTx = await conn.getTransaction(depositTx, { maxSupportedTransactionVersion: 0 });
  const wTx = await conn.getTransaction(out.signature, { maxSupportedTransactionVersion: 0 });
  const depAddrs = new Set(depTx.transaction.message.staticAccountKeys.map((k) => k.toBase58()));
  const wAddrs = wTx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  const shared = wAddrs.filter((a) => depAddrs.has(a) && a !== "11111111111111111111111111111111");
  // The pool + vault PDAs are shared by design (that's the pool); the depositor
  // wallet must NOT appear in the withdrawal.
  const depositorInWithdraw = wAddrs.includes(depositor.publicKey.toBase58());
  console.log("  depositor in withdraw tx :", depositorInWithdraw, depositorInWithdraw ? "✗ LINKED" : "✓ unlinked");
  console.log("  shared addresses (pool/vault expected):", shared.join(", ") || "none");
  console.log("\n  deposit signer  :", depositor.publicKey.toBase58());
  console.log("  withdraw signer :", wAddrs[0], "(relayer)");
  console.log("  recipient       :", recipient.toBase58(), "(fresh)");

  if (received !== expected || depositorInWithdraw) {
    console.error("\n❌ E2E FAILED");
    process.exit(1);
  }
  console.log("\n✅ E2E PASSED — deposit and withdrawal are on-chain unlinkable.");
  process.exit(0); // snarkjs leaves worker threads alive; exit explicitly
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
