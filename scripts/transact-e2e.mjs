// Phase 2 verification: full hidden-amount deposit + withdrawal through the
// on-chain `transact` instruction on devnet. Proves publicAmount/extDataHash/
// value-conservation logic agrees between circuit and program.
//
//   FUNDER=~/.config/solana/id.json node scripts/transact-e2e.mjs
import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import anchor from "@coral-xyz/anchor";
import { buildPoseidon } from "circomlibjs";
import { keccak_256 } from "@noble/hashes/sha3";
import { groth16 } from "snarkjs";
import { zk } from "@soteria1/sdk";

const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const PROGRAM = new PublicKey("9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs");
const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const Q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const LEVELS = 20, SHIELDED_ID = 0;
const WASM = "circuits/build/transaction_js/transaction.wasm";
const ZKEY = "circuits/build/transaction_final.zkey";

const P = await buildPoseidon();
const h = (...xs) => BigInt(P.F.toString(P(xs)));
const rnd = () => { const b = new Uint8Array(31); globalThis.crypto.getRandomValues(b); let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
const be32 = (v) => { v = BigInt(v); const o = new Array(32).fill(0); for (let i = 31; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; };
const zeros = (n) => Array(n).fill("0");

function note(amount, pk, blinding) {
  const pub = h(pk);
  const commitment = h(amount, pub, blinding);
  const signature = h(pk, commitment);
  const nullifier = h(commitment, signature);
  return { amount, pk, pub, blinding, commitment, nullifier };
}

function extDataHash(recipient, relayer, extAmount, fee) {
  const buf = new Uint8Array(80);
  buf.set(recipient.toBytes(), 0);
  buf.set(relayer.toBytes(), 32);
  const ea = BigInt.asUintN(64, BigInt(extAmount));
  const fe = BigInt.asUintN(64, BigInt(fee));
  for (let i = 0; i < 8; i++) { buf[64 + i] = Number((ea >> BigInt(8 * i)) & 0xffn); buf[72 + i] = Number((fe >> BigInt(8 * i)) & 0xffn); }
  const hsh = keccak_256(buf);
  hsh[0] &= 0x1f;
  let v = 0n; for (const b of hsh) v = (v << 8n) | BigInt(b);
  return v;
}

function publicAmount(extAmount, fee) {
  let v = BigInt(extAmount) - BigInt(fee);
  if (v < 0n) v += FIELD;
  return v;
}

async function prove(witness) {
  const { proof, publicSignals } = await groth16.fullProve(witness, WASM, ZKEY);
  const ax = BigInt(proof.pi_a[0]); const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q;
  const proofA = [...be32(ax), ...be32(ay)];
  const proofB = [...be32(proof.pi_b[0][1]), ...be32(proof.pi_b[0][0]), ...be32(proof.pi_b[1][1]), ...be32(proof.pi_b[1][0])];
  const proofC = [...be32(proof.pi_c[0]), ...be32(proof.pi_c[1])];
  const publicInputs = publicSignals.map((s) => be32(s));
  return { proofA, proofB, proofC, publicInputs };
}

const conn = new Connection(RPC, "confirmed");
const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER, "utf8"))));
const wallet = new anchor.Wallet(funder);
const provider = new anchor.AnchorProvider(conn, wallet, { commitment: "confirmed" });
const idl = JSON.parse(readFileSync("target/idl/soteria_verifier.json", "utf8"));
const program = new anchor.Program({ ...idl, address: PROGRAM.toBase58() }, provider);

const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const shieldedPda = PublicKey.findProgramAddressSync([Buffer.from("shielded"), u64le(SHIELDED_ID)], PROGRAM)[0];
const vaultPda = PublicKey.findProgramAddressSync([Buffer.from("shvault"), u64le(SHIELDED_ID)], PROGRAM)[0];
const nullifierPda = (nf) => PublicKey.findProgramAddressSync([Buffer.from("shnull"), shieldedPda.toBuffer(), Buffer.from(be32(nf))], PROGRAM)[0];

async function transact(signer, inputs, outputs, extAmount, fee, root, recipient, relayer, pathFor) {
  const wit = {
    root: root.toString(), publicAmount: publicAmount(extAmount, fee).toString(),
    extDataHash: extDataHash(recipient, relayer, extAmount, fee).toString(),
    inputNullifier: inputs.map((i) => i.nullifier.toString()),
    outputCommitment: outputs.map((o) => o.commitment.toString()),
    inAmount: inputs.map((i) => i.amount.toString()),
    inPrivateKey: inputs.map((i) => i.pk.toString()),
    inBlinding: inputs.map((i) => i.blinding.toString()),
    inPathIndices: inputs.map((i, k) => pathFor(i, k).pathIndices.map(String)),
    inPathElements: inputs.map((i, k) => pathFor(i, k).pathElements.map(String)),
    outAmount: outputs.map((o) => o.amount.toString()),
    outPubkey: outputs.map((o) => o.pub.toString()),
    outBlinding: outputs.map((o) => o.blinding.toString()),
  };
  const p = await prove(wit);
  return program.methods
    .transact(p.proofA, p.proofB, p.proofC, p.publicInputs, new anchor.BN(extAmount), new anchor.BN(fee))
    .accounts({
      signer: signer.publicKey, shielded: shieldedPda, vault: vaultPda,
      recipient, relayer, nullifier1: nullifierPda(inputs[0].nullifier), nullifier2: nullifierPda(inputs[1].nullifier),
    })
    .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .signers([signer]).rpc();
}

const dummyPath = { pathElements: zeros(LEVELS), pathIndices: zeros(LEVELS) };
async function main() {
  // init shielded pool (idempotent)
  try { await program.methods.initShielded(new anchor.BN(SHIELDED_ID)).accounts({ authority: funder.publicKey, shielded: shieldedPda, vault: vaultPda }).rpc(); console.log("→ shielded pool initialized"); }
  catch (e) { console.log("→ shielded pool exists"); }

  // ── DEPOSIT 0.05 SOL (an arbitrary amount) ──
  const D = 50_000_000n;
  const ownerPk = rnd(), ownerBl = rnd();
  const depositNote = note(D, ownerPk, ownerBl);
  const inD = [note(0n, rnd(), rnd()), note(0n, rnd(), rnd())];
  const outD = [depositNote, note(0n, rnd(), rnd())];
  const vBefore = await conn.getBalance(vaultPda);
  await transact(funder, inD, outD, D, 0n, 0n, funder.publicKey, funder.publicKey, () => dummyPath);
  const vAfter = await conn.getBalance(vaultPda);
  console.log("→ DEPOSIT", Number(D) / 1e9, "SOL  vault +", (vAfter - vBefore) / 1e9, "SOL", vAfter - vBefore === Number(D) ? "✓" : "✗");

  // operator inserts the deposit note + publishes the root
  const tree = await zk.PoseidonMerkleTree.create(LEVELS);
  tree.insertMany([depositNote.commitment, outD[1].commitment]);
  const root = tree.root();
  await program.methods.publishShieldedRoot(be32(root)).accounts({ authority: funder.publicKey, shielded: shieldedPda }).rpc();
  console.log("→ operator published root");

  // ── WITHDRAW 0.02 SOL to a fresh address, 0.001 fee to relayer ──
  const W = 20_000_000n, fee = 1_000_000n;
  const recipient = Keypair.generate().publicKey;
  const relayer = Keypair.generate().publicKey;
  const change = note(D - W - fee, ownerPk, rnd());
  const inW = [depositNote, note(0n, rnd(), rnd())];
  const outW = [change, note(0n, rnd(), rnd())];
  const pathFor = (i, k) => (k === 0 ? tree.proof(0) : dummyPath);
  const rBefore = await conn.getBalance(recipient);
  await transact(funder, inW, outW, -W, fee, root, recipient, relayer, pathFor);
  const rAfter = await conn.getBalance(recipient);
  const relBal = await conn.getBalance(relayer);
  console.log("→ WITHDRAW: recipient +", (rAfter - rBefore) / 1e9, "SOL", rAfter - rBefore === Number(W) ? "✓" : "✗", " relayer fee", relBal / 1e9, "SOL", relBal === Number(fee) ? "✓" : "✗");
  console.log("→ change note kept hidden:", (Number(D - W - fee)) / 1e9, "SOL (never on-chain)");

  const ok = vAfter - vBefore === Number(D) && rAfter - rBefore === Number(W) && relBal === Number(fee);
  console.log(ok ? "\n✅ PHASE 2 PASSED — hidden-amount deposit + partial withdrawal + change, on devnet" : "\n❌ FAILED");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exit(1); });
