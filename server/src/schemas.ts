import { z } from "zod";

const decimal = z.string().regex(/^\d+$/, "must be a decimal string").max(80);
const base64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64")
  .max(2048);
export const slug = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid id");

export const announceBody = z.object({
  ephemeralPub: base64,
  viewTag: z.number().int().min(0).max(255),
  stealthPub: base64.optional(),
  slot: z.number().int().nonnegative().optional(),
  signature: base64.optional(),
});

export const announcementsQuery = z.object({
  sinceSlot: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const setIdParam = z.object({ id: slug });

export const addMemberBody = z.object({ commitment: decimal });

export const createGroupBody = z.object({
  groupId: z.coerce.number().int().nonnegative(),
  setId: slug.optional(),
});

// Raw snarkjs proof + public signals; the server formats the bytes itself.
export const relayVerifyBody = z.object({
  groupId: z.coerce.number().int().nonnegative(),
  proof: z.object({
    pi_a: z.array(decimal).length(3),
    pi_b: z.array(z.array(decimal).length(2)).length(3),
    pi_c: z.array(decimal).length(3),
  }),
  // [nullifierHash, merkleRoot, externalNullifier, signalHash]
  publicSignals: z.array(decimal).length(4),
});

// ── Privacy pool (path C) ──

const pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "must be a base58 pubkey");

export const poolIdParam = z.object({
  id: z.coerce.number().int().nonnegative(),
});

export const createPoolBody = z.object({
  poolId: z.coerce.number().int().nonnegative(),
  denomination: decimal, // lamports
});

export const addCommitmentBody = z.object({ commitment: decimal });

export const setAssociationBody = z.object({
  // Curated subset of deposited commitments. Omit/empty => non-gated pool
  // (association set = every deposit).
  commitments: z.array(decimal).max(1_000_000).optional(),
});

export const poolWithdrawBody = z.object({
  recipient: pubkey,
  fee: decimal, // lamports, must match the proof's fee binding
  proof: z.object({
    pi_a: z.array(decimal).length(3),
    pi_b: z.array(z.array(decimal).length(2)).length(3),
    pi_c: z.array(decimal).length(3),
  }),
  // [nullifierHash, depositRoot, associationRoot, recipientHi, recipientLo, fee]
  publicSignals: z.array(decimal).length(6),
});

// ── Hidden-amount shielded pool (Option B) ──

const byteArr = (n: number) => z.array(z.number().int().min(0).max(255)).length(n);
const bytes32Arr = byteArr(32);
const b64ish = z.string().max(8192);

export const shieldedIdParam = z.object({ id: z.coerce.number().int().nonnegative() });

export const createShieldedBody = z.object({
  shieldedId: z.coerce.number().int().nonnegative(),
});

const formattedProof = z.object({
  proofA: byteArr(64),
  proofB: byteArr(128),
  proofC: byteArr(64),
  publicInputs: z.array(bytes32Arr).length(7),
  nullifiers: z.array(bytes32Arr).length(2),
});

const txOutputs = z.object({
  commitments: z.array(decimal).length(2),
  encryptedSecrets: z.array(b64ish).length(2),
});

// Deposit: the client signs + submits the transact tx; it just tells the
// operator to mirror the outputs.
export const shieldedDepositNotifyBody = txOutputs.extend({
  signature: z.string().min(32).max(128),
  nullifiers: z.array(bytes32Arr).length(2),
});

// Withdraw / internal transfer: the relayer signs.
export const shieldedRelayBody = z.object({
  proof: formattedProof,
  extAmount: z.string().regex(/^-?\d+$/).max(40),
  fee: decimal,
  recipient: pubkey,
  outputs: txOutputs,
});

export type AnnounceBody = z.infer<typeof announceBody>;
export type RelayVerifyBody = z.infer<typeof relayVerifyBody>;
export type PoolWithdrawBody = z.infer<typeof poolWithdrawBody>;
