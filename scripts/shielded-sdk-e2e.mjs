// Phase 3 verification: drive the hidden-amount system entirely through the SDK
// UTXO layer — deposit, scan, private internal pay with change, recipient scans.
//   FUNDER=~/.config/solana/id.json node scripts/shielded-sdk-e2e.mjs
import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import { shielded, zk } from "@soteria1/sdk";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs");
const ID = 1, LEVELS = 20;
const WASM = "circuits/build/transaction_js/transaction.wasm";
const ZKEY = "circuits/build/transaction_final.zkey";
const be32 = (v) => { v = BigInt(v); const o = new Array(32).fill(0); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const sol = (n) => Number(n) / 1e9;

const conn = new Connection(RPC, "confirmed");
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER, "utf8"))));
const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(funder), { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("target/idl/soteria_verifier.json", "utf8"));
const program = new anchor.Program({ ...idl, address: PROGRAM.toBase58() }, provider);
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const shieldedPda = PublicKey.findProgramAddressSync([Buffer.from("shielded"), u64le(ID)], PROGRAM)[0];
const vaultPda = PublicKey.findProgramAddressSync([Buffer.from("shvault"), u64le(ID)], PROGRAM)[0];
const nfPda = (nf) => PublicKey.findProgramAddressSync([Buffer.from("shnull"), shieldedPda.toBuffer(), Buffer.from(be32(nf))], PROGRAM)[0];
const rndSeed = () => { const b = new Uint8Array(64); globalThis.crypto.getRandomValues(b); return b; };

// local operator: the commitment tree + the encrypted-note records
const tree = await zk.PoseidonMerkleTree.create(LEVELS);
const records = [];
let currentRoot = 0n;

async function submit(tx, extAmount, fee, recipient, relayer) {
  await program.methods
    .transact(tx.proofA, tx.proofB, tx.proofC, tx.publicInputs, new anchor.BN(extAmount), new anchor.BN(fee))
    .accounts({ signer: funder.publicKey, shielded: shieldedPda, vault: vaultPda, recipient, relayer, nullifier1: nfPda(tx.nullifiers[0]), nullifier2: nfPda(tx.nullifiers[1]) })
    .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  // operator inserts outputs + republishes root
  const start = records.length;
  tx.outputCommitments.forEach((c, k) => { tree.insert(c); records.push({ commitment: c, encryptedSecret: tx.encryptedSecrets[k], leafIndex: start + k }); });
  currentRoot = tree.root();
  await program.methods.publishShieldedRoot(be32(currentRoot)).accounts({ authority: funder.publicKey, shielded: shieldedPda }).rpc();
}

async function main() {
  try { await program.methods.initShielded(new anchor.BN(ID)).accounts({ authority: funder.publicKey, shielded: shieldedPda, vault: vaultPda }).rpc(); console.log("→ shielded pool #1 initialized"); }
  catch { console.log("→ shielded pool #1 exists (reusing)"); }

  const alice = await shielded.deriveShieldedKeypair(rndSeed());
  const bob = await shielded.deriveShieldedKeypair(rndSeed());

  // ── 1. Alice deposits 0.05 SOL ──
  const D = 50_000_000n;
  const depTx = await shielded.buildTransaction({
    inputs: [], outputs: [{ note: shielded.newNote(D, alice.publicKey), encPub: alice.encPub }],
    spendKeypair: alice, extAmount: D, fee: 0n, recipient: funder.publicKey, relayer: funder.publicKey,
    root: currentRoot, wasmPath: WASM, zkeyPath: ZKEY,
  });
  await submit(depTx, D, 0n, funder.publicKey, funder.publicKey);
  console.log("→ Alice deposited", sol(D), "SOL");

  // ── 2. Alice scans → finds her note ──
  let aliceNotes = await shielded.scanOutputs(records, alice);
  console.log("→ Alice scan: balance", sol(shielded.balance(aliceNotes)), "SOL", shielded.balance(aliceNotes) === D ? "✓" : "✗");

  // ── 3. Alice privately pays Bob 0.02 SOL (fee 0.001), keeps change ──
  const pay = 20_000_000n, fee = 1_000_000n;
  const change = D - pay - fee;
  const aIn = aliceNotes[0];
  const proof = tree.proof(aIn.leafIndex);
  const payTx = await shielded.buildTransaction({
    inputs: [{ note: { amount: aIn.amount, pubkey: aIn.pubkey, blinding: aIn.blinding }, pathElements: proof.pathElements, pathIndices: proof.pathIndices }],
    outputs: [
      { note: shielded.newNote(pay, bob.publicKey), encPub: bob.encPub },
      { note: shielded.newNote(change, alice.publicKey), encPub: alice.encPub },
    ],
    spendKeypair: alice, extAmount: 0n, fee, recipient: funder.publicKey, relayer: funder.publicKey,
    root: currentRoot, wasmPath: WASM, zkeyPath: ZKEY,
  });
  await submit(payTx, 0n, fee, funder.publicKey, funder.publicKey);
  console.log("→ Alice paid Bob", sol(pay), "SOL privately (fee", sol(fee) + "), change", sol(change));

  // ── 4. Bob scans → finds the payment; Alice finds her change ──
  const bobNotes = await shielded.scanOutputs(records, bob);
  aliceNotes = await shielded.scanOutputs(records, alice);
  const aliceSpendable = aliceNotes.filter((n) => n.leafIndex >= 2); // her change (old note spent)
  console.log("→ Bob scan: received", sol(shielded.balance(bobNotes)), "SOL", shielded.balance(bobNotes) === pay ? "✓" : "✗");
  console.log("→ Alice change note:", sol(shielded.balance(aliceSpendable)), "SOL", shielded.balance(aliceSpendable) === change ? "✓" : "✗");

  const ok = shielded.balance(bobNotes) === pay && shielded.balance(aliceSpendable) === change;
  console.log(ok ? "\n✅ PHASE 3 PASSED — SDK drives deposit, scan, private pay + change, recipient scan" : "\n❌ FAILED");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
