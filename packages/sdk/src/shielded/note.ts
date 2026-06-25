import { H, FIELD } from "./keypair";
import { encryptNote as eciesEncrypt, decryptNote as eciesDecrypt } from "../pool/crypto";

/**
 * A shielded UTXO. `amount` and `blinding` are secret; `pubkey` is the owner's
 * shielded publicKey. commitment = Poseidon(amount, pubkey, blinding).
 */
export interface Note {
  amount: bigint;
  pubkey: bigint;
  blinding: bigint;
}

export function randomBlinding(): bigint {
  const b = new Uint8Array(31);
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % FIELD;
}

export function newNote(amount: bigint, pubkey: bigint): Note {
  return { amount, pubkey, blinding: randomBlinding() };
}

export const commitment = (n: Note): Promise<bigint> => H([n.amount, n.pubkey, n.blinding]);

/** nullifier = Poseidon(commitment, Poseidon(privateKey, commitment)). Needs the
 *  owner's spending key, so only the owner can spend the note. */
export async function nullifier(n: Note, privateKey: bigint): Promise<bigint> {
  const cm = await commitment(n);
  const sig = await H([privateKey, cm]);
  return H([cm, sig]);
}

// ── note-secret encryption (so a recipient can find + spend the note) ──

/** Encrypt a note's secret (amount, blinding) to a recipient's X25519 enc key. */
export function encryptNoteSecret(n: Note, recipientEncPub: Uint8Array): Promise<string> {
  return eciesEncrypt(`${n.amount.toString(16)}:${n.blinding.toString(16)}`, recipientEncPub);
}

/** Decrypt a note secret with the owner's X25519 enc key. Throws if not ours. */
export async function decryptNoteSecret(
  blob: string,
  encPriv: Uint8Array
): Promise<{ amount: bigint; blinding: bigint }> {
  const s = await eciesDecrypt(blob, encPriv);
  const [a, b] = s.split(":");
  return { amount: BigInt("0x" + a), blinding: BigInt("0x" + b) };
}
