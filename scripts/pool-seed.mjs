// Batch-seed a pool with many deposits so the anonymity set is large.
// Funds one keypair, batches several deposits per transaction, notifies the
// operator, then publishes the deposit + association roots once at the end.
//
//   COUNT=100 POOL_ID=2 node scripts/pool-seed.mjs
import {
  Connection,
  Keypair,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { pool } from "@soteria/sdk";
import { config as dotenv } from "dotenv";

dotenv({ path: "server/.env" });

const SERVER = process.env.SERVER ?? "http://127.0.0.1:8787";
const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const API_KEY = process.env.ADMIN_API_KEY;
const POOL_ID = Number(process.env.POOL_ID ?? 2);
const COUNT = Number(process.env.COUNT ?? 100);
const DENOM = 100_000_000; // 0.1 SOL
const PER_TX = 4;

const conn = new Connection(RPC, "confirmed");
const j = (label) => async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label}: ${res.status} ${JSON.stringify(body)}`);
  return body;
};
const post = (path, body, admin = false) =>
  fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(admin ? { "x-api-key": API_KEY } : {}) },
    body: JSON.stringify(body),
  }).then(j(`POST ${path}`));

async function main() {
  await post("/pools", { poolId: POOL_ID, denomination: String(DENOM) }, true).catch((e) => {
    if (!/duplicate/.test(String(e))) throw e;
  });

  const funder = Keypair.generate();
  const need = Math.ceil(COUNT * 0.12) + 3;
  console.log(`→ funding ${need} SOL for ${COUNT} deposits`);
  // Airdrop in chunks — the local faucet caps a single request.
  for (let left = need; left > 0; left -= 50) {
    const amt = Math.min(50, left);
    await conn.confirmTransaction(
      await conn.requestAirdrop(funder.publicKey, amt * LAMPORTS_PER_SOL),
      "confirmed"
    );
  }

  let done = 0;
  for (let i = 0; i < COUNT; i += PER_TX) {
    const batch = [];
    const tx = new Transaction();
    for (let k = 0; k < PER_TX && i + k < COUNT; k++) {
      const commitment = await pool.commitment(pool.randomNote(POOL_ID));
      batch.push(commitment);
      tx.add(pool.depositInstruction(funder.publicKey, POOL_ID, commitment));
    }
    tx.feePayer = funder.publicKey;
    await sendAndConfirmTransaction(conn, tx, [funder], { commitment: "confirmed" });
    for (const c of batch)
      await post(`/pools/${POOL_ID}/commitments?publish=false`, { commitment: c.toString() });
    done += batch.length;
    if (done % 20 === 0 || done === COUNT) console.log(`  ${done}/${COUNT} deposited`);
  }

  console.log("→ publishing deposit + association roots");
  await post(`/pools/${POOL_ID}/publish`, {}, true);
  await post(`/pools/${POOL_ID}/association`, {}, true);

  const state = await fetch(`${SERVER}/pools/${POOL_ID}`).then(j("GET pool"));
  console.log(`\n✅ pool #${POOL_ID} anonymity set: ${state.anonymitySet}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
