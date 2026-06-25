use anchor_lang::prelude::*;

#[error_code]
pub enum SoteriaError {
    #[msg("merkle root is not among the group's recent published roots")]
    UnknownRoot,
    #[msg("merkle root cannot be zero")]
    ZeroRoot,
    #[msg("proof bytes are malformed")]
    MalformedProof,
    #[msg("zero-knowledge proof failed verification")]
    ProofVerificationFailed,
    #[msg("new authority cannot be the default pubkey")]
    InvalidAuthority,
    #[msg("proof's external nullifier does not match the expected scope")]
    ScopeMismatch,

    // ── Privacy pool ──
    #[msg("association root does not match the pool's curated set")]
    UnknownAssociationRoot,
    #[msg("proof's recipient binding does not match the recipient account")]
    RecipientMismatch,
    #[msg("proof's fee binding does not match the fee argument")]
    FeeMismatch,
    #[msg("fee exceeds the pool denomination")]
    FeeTooHigh,
    #[msg("pool denomination must be non-zero")]
    ZeroDenomination,

    // ── Hidden-amount shielded pool ──
    #[msg("proof's publicAmount does not match the declared ext_amount/fee")]
    PublicAmountMismatch,
    #[msg("proof's extDataHash does not match the transaction's external data")]
    ExtDataHashMismatch,
    #[msg("the two input nullifiers must differ")]
    DuplicateNullifier,
    #[msg("vault has insufficient balance for this withdrawal")]
    InsufficientVault,
}
