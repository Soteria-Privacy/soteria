import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import type { FormattedTx } from "./prover";

export const SHIELDED_PROGRAM_ID = new PublicKey(
  "9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs"
);

// sha256("global:transact")[0..8]
const TRANSACT_DISCRIMINATOR = new Uint8Array([217, 149, 130, 143, 221, 52, 252, 119]);

function u64le(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export function shieldedPda(id: bigint | number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("shielded"), u64le(id)],
    SHIELDED_PROGRAM_ID
  )[0];
}
export function shieldedVaultPda(id: bigint | number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("shvault"), u64le(id)],
    SHIELDED_PROGRAM_ID
  )[0];
}
export function shieldedNullifierPda(id: bigint | number, nullifier: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("shnull"), shieldedPda(id).toBuffer(), Buffer.from(nullifier)],
    SHIELDED_PROGRAM_ID
  )[0];
}

/**
 * Build the `transact` instruction (client-signed — used for deposits, where the
 * signer funds the vault). The SDK has no Anchor dep, so the args are encoded by
 * hand: disc ++ proofA ++ proofB ++ proofC ++ publicInputs(7*32) ++ ext(i64) ++ fee(u64).
 */
export function transactInstruction(opts: {
  shieldedId: bigint | number;
  signer: PublicKey;
  recipient: PublicKey;
  relayer: PublicKey;
  tx: FormattedTx;
  extAmount: bigint;
  fee: bigint;
}): TransactionInstruction {
  const { shieldedId, signer, recipient, relayer, tx, extAmount, fee } = opts;

  const flatPublicInputs = tx.publicInputs.flat(); // 7 * 32 = 224 bytes
  const extLe = Buffer.alloc(8);
  extLe.writeBigInt64LE(extAmount);
  const data = Buffer.concat([
    Buffer.from(TRANSACT_DISCRIMINATOR),
    Buffer.from(tx.proofA),
    Buffer.from(tx.proofB),
    Buffer.from(tx.proofC),
    Buffer.from(flatPublicInputs),
    extLe,
    u64le(fee),
  ]);

  const keys = [
    { pubkey: signer, isSigner: true, isWritable: true },
    { pubkey: shieldedPda(shieldedId), isSigner: false, isWritable: true },
    { pubkey: shieldedVaultPda(shieldedId), isSigner: false, isWritable: true },
    { pubkey: recipient, isSigner: false, isWritable: true },
    { pubkey: relayer, isSigner: false, isWritable: true },
    // publicInputs[3], [4] = the two nullifiers (byte form), per the circuit order
    { pubkey: shieldedNullifierPda(shieldedId, tx.publicInputs[3]), isSigner: false, isWritable: true },
    { pubkey: shieldedNullifierPda(shieldedId, tx.publicInputs[4]), isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId: SHIELDED_PROGRAM_ID, keys, data });
}
