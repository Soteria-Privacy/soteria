import { groth16 } from "snarkjs";
import { keccak_256 } from "@noble/hashes/sha3";
import { PublicKey } from "@solana/web3.js";
import { H, FIELD, ShieldedKeypair } from "./keypair";
import { Note, newNote, commitment, nullifier, encryptNoteSecret } from "./note";

// BN254 base field (for negating proof.A).
const Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const LEVELS = 20;

function be32(v: bigint | string): number[] {
  let x = BigInt(v);
  const o = new Array<number>(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    o[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return o;
}

// keccak(recipient || relayer || extAmount_le_i64 || fee_le_u64), masked below
// the field — MUST byte-match the program's ext_data_hash.
export function extDataHash(
  recipient: PublicKey,
  relayer: PublicKey,
  extAmount: bigint,
  fee: bigint
): bigint {
  const buf = new Uint8Array(80);
  buf.set(recipient.toBytes(), 0);
  buf.set(relayer.toBytes(), 32);
  const ea = BigInt.asUintN(64, extAmount);
  const fe = BigInt.asUintN(64, fee);
  for (let i = 0; i < 8; i++) {
    buf[64 + i] = Number((ea >> BigInt(8 * i)) & 0xffn);
    buf[72 + i] = Number((fe >> BigInt(8 * i)) & 0xffn);
  }
  const hsh = keccak_256(buf);
  hsh[0] &= 0x1f;
  let v = 0n;
  for (const b of hsh) v = (v << 8n) | BigInt(b);
  return v;
}

/** publicAmount = (extAmount - fee) mod p. */
export function publicAmount(extAmount: bigint, fee: bigint): bigint {
  let v = extAmount - fee;
  if (v < 0n) v += FIELD;
  return v % FIELD;
}

export interface TxInput {
  note: Note;
  pathElements: bigint[];
  pathIndices: number[];
}

export interface TxOutput {
  note: Note;
  /** Recipient's X25519 enc key; the note secret is encrypted to it. */
  encPub: Uint8Array;
}

export interface BuildTxParams {
  /** Real notes being spent (0–2). Padded to 2 with dummies. */
  inputs: TxInput[];
  /** Outputs (1–2). Padded to 2 with a dummy owned by the spender. */
  outputs: TxOutput[];
  /** Spender — owns every input and any padding dummies. */
  spendKeypair: ShieldedKeypair;
  extAmount: bigint; // +deposit / -withdraw / 0 internal
  fee: bigint;
  recipient: PublicKey;
  relayer: PublicKey;
  root: bigint;
  wasmPath: string;
  zkeyPath: string;
}

export interface FormattedTx {
  proofA: number[];
  proofB: number[];
  proofC: number[];
  publicInputs: number[][]; // [root, publicAmount, extDataHash, nf0, nf1, oc0, oc1]
  nullifiers: bigint[];
  outputCommitments: bigint[];
  /** Encrypted note secrets, aligned to outputCommitments — hand to the operator. */
  encryptedSecrets: string[];
}

const zeros = (n: number) => Array(n).fill("0");

/**
 * Build a hidden-amount transaction proof for the on-chain `transact`
 * instruction. Caller must ensure Σinputs + extAmount == Σoutputs + fee.
 */
export async function buildTransaction(p: BuildTxParams): Promise<FormattedTx> {
  const sk = p.spendKeypair;

  const inputs = [...p.inputs];
  while (inputs.length < 2) {
    inputs.push({ note: newNote(0n, sk.publicKey), pathElements: zeros(LEVELS).map(BigInt), pathIndices: Array(LEVELS).fill(0) });
  }
  const outputs: TxOutput[] = [...p.outputs];
  while (outputs.length < 2) outputs.push({ note: newNote(0n, sk.publicKey), encPub: sk.encPub });

  const inNullifiers = await Promise.all(inputs.map((i) => nullifier(i.note, sk.privateKey)));
  const outCommitments = await Promise.all(outputs.map((o) => commitment(o.note)));
  const encryptedSecrets = await Promise.all(outputs.map((o) => encryptNoteSecret(o.note, o.encPub)));

  const witness = {
    root: p.root.toString(),
    publicAmount: publicAmount(p.extAmount, p.fee).toString(),
    extDataHash: extDataHash(p.recipient, p.relayer, p.extAmount, p.fee).toString(),
    inputNullifier: inNullifiers.map(String),
    outputCommitment: outCommitments.map(String),
    inAmount: inputs.map((i) => i.note.amount.toString()),
    inPrivateKey: inputs.map(() => sk.privateKey.toString()),
    inBlinding: inputs.map((i) => i.note.blinding.toString()),
    inPathIndices: inputs.map((i) => i.pathIndices.map(String)),
    inPathElements: inputs.map((i) => i.pathElements.map(String)),
    outAmount: outputs.map((o) => o.note.amount.toString()),
    outPubkey: outputs.map((o) => o.note.pubkey.toString()),
    outBlinding: outputs.map((o) => o.note.blinding.toString()),
  };

  const { proof, publicSignals } = await groth16.fullProve(witness, p.wasmPath, p.zkeyPath);
  const ax = BigInt(proof.pi_a[0]);
  const ay = (Q - (BigInt(proof.pi_a[1]) % Q)) % Q;
  return {
    proofA: [...be32(ax), ...be32(ay)],
    proofB: [
      ...be32(proof.pi_b[0][1]), ...be32(proof.pi_b[0][0]),
      ...be32(proof.pi_b[1][1]), ...be32(proof.pi_b[1][0]),
    ],
    proofC: [...be32(proof.pi_c[0]), ...be32(proof.pi_c[1])],
    publicInputs: publicSignals.map((s: string) => be32(s)),
    nullifiers: inNullifiers,
    outputCommitments: outCommitments,
    encryptedSecrets,
  };
}
