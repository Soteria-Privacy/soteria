use anchor_lang::prelude::*;
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

// Generated from verification_key.json via groth16-solana's vk parser.
// Place the converted constant in verifying_key.rs and `include!` it here.
// pub const VERIFYINGKEY: Groth16Verifyingkey = ...;
mod verifying_key;
use verifying_key::VERIFYINGKEY;

declare_id!("Aeg1sVeri11111111111111111111111111111111111");

// Public inputs, in the order the circuit declares them, each big-endian 32 bytes:
//   [0] merkleRoot
//   [1] externalNullifier
//   [2] signalHash
//   [3] nullifierHash   (public OUTPUT — snarkjs lists outputs before inputs)
//
// IMPORTANT: snarkjs orders public signals as [outputs..., publicInputs...].
// So the on-chain order is: [nullifierHash, merkleRoot, externalNullifier, signalHash].
const NUM_PUBLIC_INPUTS: usize = 4;

#[program]
pub mod soteria_verifier {
    use super::*;

    /// Verify a selective-disclosure proof and burn its nullifier so the same
    /// identity cannot act twice within `external_nullifier`'s scope.
    pub fn verify(
        ctx: Context<Verify>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS],
    ) -> Result<()> {
        // The nullifier PDA is seeded by nullifierHash; if it already exists,
        // account init fails => double-action is rejected at the account layer.
        // (public_inputs[0] == nullifierHash, see ordering note above.)
        require!(
            ctx.accounts.nullifier.seed == public_inputs[0],
            SoteriaError::NullifierMismatch
        );

        let mut verifier =
            Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYINGKEY)
                .map_err(|_| SoteriaError::MalformedProof)?;

        verifier
            .verify()
            .map_err(|_| SoteriaError::ProofVerificationFailed)?;

        // Record the merkle root the proof was made against (caller validates
        // it matches a known/recent published root before trusting the result).
        let n = &mut ctx.accounts.nullifier;
        n.merkle_root = public_inputs[1];
        n.spent = true;
        n.bump = ctx.bumps.nullifier;

        emit!(Disclosed {
            nullifier_hash: public_inputs[0],
            merkle_root: public_inputs[1],
            external_nullifier: public_inputs[2],
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS]
)]
pub struct Verify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // PDA seeded by the nullifier hash. `init` => fails if already spent.
    #[account(
        init,
        payer = payer,
        space = 8 + Nullifier::SIZE,
        seeds = [b"nullifier", public_inputs[0].as_ref()],
        bump
    )]
    pub nullifier: Account<'info, Nullifier>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct Nullifier {
    pub seed: [u8; 32],        // == nullifierHash
    pub merkle_root: [u8; 32],
    pub spent: bool,
    pub bump: u8,
}
impl Nullifier {
    pub const SIZE: usize = 32 + 32 + 1 + 1;
}

#[event]
pub struct Disclosed {
    pub nullifier_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub external_nullifier: [u8; 32],
}

#[error_code]
pub enum SoteriaError {
    #[msg("nullifier PDA seed does not match the proof's nullifier hash")]
    NullifierMismatch,
    #[msg("proof bytes are malformed")]
    MalformedProof,
    #[msg("zero-knowledge proof failed verification")]
    ProofVerificationFailed,
}
