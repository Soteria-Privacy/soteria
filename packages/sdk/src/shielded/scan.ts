import { ShieldedKeypair } from "./keypair.js";
import { Note, commitment, nullifier, decryptNoteSecret } from "./note.js";

/** One output emitted by `transact`, paired with its encrypted secret. */
export interface OutputRecord {
  commitment: bigint;
  encryptedSecret: string;
  leafIndex: number;
}

export interface OwnedNote extends Note {
  leafIndex: number;
  nullifier: bigint;
}

/**
 * Scan emitted outputs for notes owned by `kp`: decrypt each secret, and keep it
 * if the reconstructed commitment matches and the amount is non-zero. Returns
 * spendable UTXOs (callers should drop any whose nullifier is already spent
 * on-chain).
 */
export async function scanOutputs(
  records: OutputRecord[],
  kp: ShieldedKeypair
): Promise<OwnedNote[]> {
  const owned: OwnedNote[] = [];
  for (const r of records) {
    let secret;
    try {
      secret = await decryptNoteSecret(r.encryptedSecret, kp.encPriv);
    } catch {
      continue; // not encrypted to us
    }
    const note: Note = { amount: secret.amount, pubkey: kp.publicKey, blinding: secret.blinding };
    if (secret.amount === 0n) continue;
    if ((await commitment(note)) !== r.commitment) continue;
    owned.push({ ...note, leafIndex: r.leafIndex, nullifier: await nullifier(note, kp.privateKey) });
  }
  return owned;
}

/** Total spendable balance from a set of owned notes. */
export const balance = (notes: OwnedNote[]): bigint =>
  notes.reduce((s, n) => s + n.amount, 0n);
