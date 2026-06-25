use anchor_lang::prelude::*;

#[constant]
pub const GROUP_SEED: &[u8] = b"group";

#[constant]
pub const NULLIFIER_SEED: &[u8] = b"nullifier";

/// Merkle depth — MUST match circuits/credential.circom (`Credential(20)`).
pub const TREE_DEPTH: u8 = 20;

/// Number of recent roots accepted by `verify_proof`. Sized to keep the `Group`
/// account's Borsh deserialization within the BPF 4KB stack frame limit.
pub const ROOT_HISTORY_SIZE: usize = 32;

pub const NUM_PUBLIC_INPUTS: usize = 4;

// snarkjs orders public signals as [outputs..., publicInputs...], so the
// on-chain order is: [nullifierHash, merkleRoot, externalNullifier, signalHash].
pub const PI_NULLIFIER_HASH: usize = 0;
pub const PI_MERKLE_ROOT: usize = 1;
pub const PI_EXTERNAL_NULLIFIER: usize = 2;
pub const PI_SIGNAL_HASH: usize = 3;

// ── Privacy pool (path C) ──────────────────────────────────────────────────

#[constant]
pub const POOL_SEED: &[u8] = b"pool";

#[constant]
pub const VAULT_SEED: &[u8] = b"vault";

#[constant]
pub const COMMITMENT_SEED: &[u8] = b"commit";

#[constant]
pub const POOL_NULLIFIER_SEED: &[u8] = b"pool_null";

/// Public-signal count of circuits/withdraw.circom.
pub const POOL_NUM_PUBLIC_INPUTS: usize = 6;

// withdraw.circom public-signal order: [outputs..., publicInputs...]
//   = [nullifierHash, depositRoot, associationRoot, recipientHi, recipientLo, fee]
pub const PI_POOL_NULLIFIER_HASH: usize = 0;
pub const PI_POOL_DEPOSIT_ROOT: usize = 1;
pub const PI_POOL_ASSOCIATION_ROOT: usize = 2;
pub const PI_POOL_RECIPIENT_HI: usize = 3;
pub const PI_POOL_RECIPIENT_LO: usize = 4;
pub const PI_POOL_FEE: usize = 5;

// ── Hidden-amount shielded pool (Option B) ─────────────────────────────────

#[constant]
pub const SHIELDED_SEED: &[u8] = b"shielded";

#[constant]
pub const SHIELDED_VAULT_SEED: &[u8] = b"shvault";

#[constant]
pub const SHIELDED_NULLIFIER_SEED: &[u8] = b"shnull";

/// Public-signal count of circuits/transaction.circom (2-in / 2-out).
pub const TX_NUM_PUBLIC_INPUTS: usize = 7;

// transaction.circom public-signal order (all `public`, no outputs):
//   [root, publicAmount, extDataHash, inputNullifier[0..2], outputCommitment[0..2]]
pub const PI_TX_ROOT: usize = 0;
pub const PI_TX_PUBLIC_AMOUNT: usize = 1;
pub const PI_TX_EXT_DATA_HASH: usize = 2;
pub const PI_TX_NULLIFIER_1: usize = 3;
pub const PI_TX_NULLIFIER_2: usize = 4;
pub const PI_TX_OUT_COMMIT_1: usize = 5;
pub const PI_TX_OUT_COMMIT_2: usize = 6;

/// BN254 scalar field modulus, big-endian. publicAmount is computed mod this.
pub const FIELD_MODULUS_BE: [u8; 32] = [
    48, 100, 78, 114, 225, 49, 160, 41, 184, 80, 69, 182, 129, 129, 88, 93, 40, 51, 232, 72, 121,
    185, 112, 145, 67, 225, 245, 147, 240, 0, 0, 1,
];
