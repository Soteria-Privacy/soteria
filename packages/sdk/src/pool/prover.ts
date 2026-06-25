import { groth16 } from "snarkjs";
import { PublicKey } from "@solana/web3.js";
import { PoseidonMerkleTree } from "../zk/merkle.js";
import { Note } from "./note.js";

// BN254 base field prime (for negating proof.A, per groth16-solana convention).
const Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function toBE32(dec: string | bigint): number[] {
  let v = BigInt(dec);
  const out = new Array<number>(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Split a 32-byte pubkey into two 128-bit field limbs (hi = first 16 bytes). */
export function recipientLimbs(recipient: PublicKey): { hi: bigint; lo: bigint } {
  const b = recipient.toBytes();
  let hi = 0n;
  for (let i = 0; i < 16; i++) hi = (hi << 8n) | BigInt(b[i]);
  let lo = 0n;
  for (let i = 16; i < 32; i++) lo = (lo << 8n) | BigInt(b[i]);
  return { hi, lo };
}

export interface WithdrawInputs {
  note: Note;
  /** Pool deposit tree and the note's leaf index in it. */
  depositTree: PoseidonMerkleTree;
  depositLeafIndex: number;
  /** Association-set tree and the note's leaf index in it. For a non-gated pool
   *  this is the same tree as `depositTree`. */
  assocTree: PoseidonMerkleTree;
  assocLeafIndex: number;
  recipient: PublicKey;
  fee: bigint;
}

export interface FormattedProof {
  proofA: number[]; // 64
  proofB: number[]; // 128
  proofC: number[]; // 64
  // [nullifierHash, depositRoot, associationRoot, recipientHi, recipientLo, fee]
  publicInputs: number[][];
}

export interface RawProof {
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  publicSignals: string[];
}

function buildWitness(inputs: WithdrawInputs) {
  const { note, depositTree, depositLeafIndex, assocTree, assocLeafIndex, recipient, fee } =
    inputs;
  const dep = depositTree.proof(depositLeafIndex);
  const assoc = assocTree.proof(assocLeafIndex);
  const { hi, lo } = recipientLimbs(recipient);

  return {
    nullifier: note.nullifier.toString(),
    secret: note.secret.toString(),
    depositPathElements: dep.pathElements.map((x) => x.toString()),
    depositPathIndices: dep.pathIndices.map((x) => x.toString()),
    assocPathElements: assoc.pathElements.map((x) => x.toString()),
    assocPathIndices: assoc.pathIndices.map((x) => x.toString()),
    depositRoot: depositTree.root().toString(),
    associationRoot: assocTree.root().toString(),
    recipientHi: hi.toString(),
    recipientLo: lo.toString(),
    fee: fee.toString(),
  };
}

/**
 * Raw snarkjs proof + public signals. Use this for the relay path (the relayer
 * formats bytes server-side). Requires app/public/withdraw.{wasm,zkey}.
 */
export async function proveWithdrawRaw(
  inputs: WithdrawInputs,
  wasmPath: string,
  zkeyPath: string
): Promise<RawProof> {
  const witness = buildWitness(inputs);
  const { proof, publicSignals } = await groth16.fullProve(witness, wasmPath, zkeyPath);
  return { proof, publicSignals };
}

/**
 * Withdraw proof formatted for the on-chain `withdraw` instruction (direct
 * submission). For the relay path, use proveWithdrawRaw.
 */
export async function proveWithdraw(
  inputs: WithdrawInputs,
  wasmPath: string,
  zkeyPath: string
): Promise<FormattedProof> {
  const { proof, publicSignals } = await proveWithdrawRaw(inputs, wasmPath, zkeyPath);

  // proof.A : negate y, then x||y big-endian (groth16-solana wants -A)
  const ax = BigInt(proof.pi_a[0]);
  const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q;
  const proofA = [...toBE32(ax), ...toBE32(ay)];

  // proof.B : G2, swap the c0/c1 ordering snarkjs emits
  const proofB = [
    ...toBE32(proof.pi_b[0][1]),
    ...toBE32(proof.pi_b[0][0]),
    ...toBE32(proof.pi_b[1][1]),
    ...toBE32(proof.pi_b[1][0]),
  ];

  // proof.C : x||y big-endian
  const proofC = [...toBE32(proof.pi_c[0]), ...toBE32(proof.pi_c[1])];

  const publicInputs = publicSignals.map((s: string) => toBE32(s));

  return { proofA, proofB, proofC, publicInputs };
}
