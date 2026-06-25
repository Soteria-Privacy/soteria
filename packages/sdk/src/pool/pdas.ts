import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { toBytes32 } from "./note.js";
import type { FormattedProof } from "./prover.js";

export const POOL_PROGRAM_ID = new PublicKey(
  "9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs"
);

// sha256("global:deposit")[0..8] — the Anchor instruction discriminator.
const DEPOSIT_DISCRIMINATOR = new Uint8Array([242, 35, 198, 137, 82, 225, 242, 182]);

function u64le(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export function poolPda(poolId: bigint | number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), u64le(poolId)],
    POOL_PROGRAM_ID
  );
}

export function vaultPda(poolId: bigint | number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), u64le(poolId)],
    POOL_PROGRAM_ID
  );
}

export function commitmentPda(
  poolId: bigint | number,
  commitment: bigint
): [PublicKey, number] {
  const [pool] = poolPda(poolId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commit"), pool.toBuffer(), Buffer.from(toBytes32(commitment))],
    POOL_PROGRAM_ID
  );
}

export function poolNullifierPda(
  poolId: bigint | number,
  nullifierHash: bigint
): [PublicKey, number] {
  const [pool] = poolPda(poolId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_null"), pool.toBuffer(), Buffer.from(toBytes32(nullifierHash))],
    POOL_PROGRAM_ID
  );
}

const SYS = { pubkey: SystemProgram.programId, isSigner: false, isWritable: false };

/** Accounts for `init_pool(pool_id, denomination)`. */
export function buildInitPoolAccounts(authority: PublicKey, poolId: bigint | number) {
  const [pool] = poolPda(poolId);
  const [vault] = vaultPda(poolId);
  return {
    programId: POOL_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      SYS,
    ],
  };
}

/** Accounts for `deposit(commitment)`. */
export function buildDepositAccounts(
  depositor: PublicKey,
  poolId: bigint | number,
  commitment: bigint
) {
  const [pool] = poolPda(poolId);
  const [vault] = vaultPda(poolId);
  const [commitmentRecord] = commitmentPda(poolId, commitment);
  return {
    programId: POOL_PROGRAM_ID,
    keys: [
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: commitmentRecord, isSigner: false, isWritable: true },
      SYS,
    ],
  };
}

/**
 * Full `deposit(commitment)` instruction, signed client-side by the depositor.
 * Build a transaction with this and send it through the wallet — the SDK has no
 * Anchor dependency, so the discriminator is encoded directly.
 */
export function depositInstruction(
  depositor: PublicKey,
  poolId: bigint | number,
  commitment: bigint
): TransactionInstruction {
  const { keys } = buildDepositAccounts(depositor, poolId, commitment);
  const data = new Uint8Array(8 + 32);
  data.set(DEPOSIT_DISCRIMINATOR, 0);
  data.set(toBytes32(commitment), 8);
  return new TransactionInstruction({
    programId: POOL_PROGRAM_ID,
    keys,
    data: Buffer.from(data),
  });
}

/** Accounts for `publish_pool_root` / `set_association_root` (authority only). */
export function buildUpdatePoolRootAccounts(
  authority: PublicKey,
  poolId: bigint | number
) {
  const [pool] = poolPda(poolId);
  return {
    programId: POOL_PROGRAM_ID,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: pool, isSigner: false, isWritable: true },
    ],
  };
}

/**
 * Accounts for `withdraw(...)`. `nullifierHash` is publicInputs[0] decoded back
 * to a bigint; pass the same value used to derive the proof.
 */
export function buildWithdrawAccounts(
  relayer: PublicKey,
  poolId: bigint | number,
  recipient: PublicKey,
  nullifierHash: bigint
) {
  const [pool] = poolPda(poolId);
  const [vault] = vaultPda(poolId);
  const [nullifier] = poolNullifierPda(poolId, nullifierHash);
  return {
    programId: POOL_PROGRAM_ID,
    keys: [
      { pubkey: relayer, isSigner: true, isWritable: true },
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: nullifier, isSigner: false, isWritable: true },
      SYS,
    ],
  };
}

/** Convenience: the bigint nullifierHash carried in a formatted proof. */
export function nullifierHashFromProof(proof: FormattedProof): bigint {
  let v = 0n;
  for (const byte of proof.publicInputs[0]) v = (v << 8n) | BigInt(byte);
  return v;
}
