use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
mod verifying_key;
mod verifying_key_pool;
mod verifying_key_transaction;

use constants::{NUM_PUBLIC_INPUTS, POOL_NUM_PUBLIC_INPUTS, TX_NUM_PUBLIC_INPUTS};
use instructions::*;

#[cfg(test)]
mod test_vectors;

declare_id!("9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs");

const _: () = assert!(
    verifying_key::VERIFYINGKEY.nr_pubinputs as usize == NUM_PUBLIC_INPUTS,
    "VERIFYINGKEY public-input count must match the circuit"
);

const _: () = assert!(
    verifying_key_pool::VERIFYINGKEY_POOL.nr_pubinputs as usize == POOL_NUM_PUBLIC_INPUTS,
    "VERIFYINGKEY_POOL public-input count must match circuits/withdraw.circom"
);

const _: () = assert!(
    verifying_key_transaction::VERIFYINGKEY_TRANSACTION.nr_pubinputs as usize == TX_NUM_PUBLIC_INPUTS,
    "VERIFYINGKEY_TRANSACTION public-input count must match circuits/transaction.circom"
);

#[program]
pub mod soteria_verifier {
    use super::*;

    pub fn create_group(ctx: Context<CreateGroup>, group_id: u64) -> Result<()> {
        instructions::create_group::handler(ctx, group_id)
    }

    pub fn publish_root(ctx: Context<PublishRoot>, new_root: [u8; 32]) -> Result<()> {
        instructions::publish_root::handler(ctx, new_root)
    }

    pub fn set_authority(ctx: Context<SetAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::set_authority::handler(ctx, new_authority)
    }

    pub fn verify_proof(
        ctx: Context<VerifyProof>,
        external_nullifier: [u8; 32],
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; NUM_PUBLIC_INPUTS],
    ) -> Result<()> {
        instructions::verify_proof::handler(
            ctx,
            external_nullifier,
            proof_a,
            proof_b,
            proof_c,
            public_inputs,
        )
    }

    // ── Privacy pool (path C) ──

    pub fn init_pool(ctx: Context<InitPool>, pool_id: u64, denomination: u64) -> Result<()> {
        instructions::init_pool::handler(ctx, pool_id, denomination)
    }

    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32]) -> Result<()> {
        instructions::deposit::handler(ctx, commitment)
    }

    pub fn publish_pool_root(ctx: Context<UpdatePoolRoot>, new_root: [u8; 32]) -> Result<()> {
        instructions::publish_pool_root::publish_pool_root(ctx, new_root)
    }

    pub fn set_association_root(
        ctx: Context<UpdatePoolRoot>,
        association_root: [u8; 32],
    ) -> Result<()> {
        instructions::publish_pool_root::set_association_root(ctx, association_root)
    }

    pub fn withdraw(
        ctx: Context<Withdraw>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; POOL_NUM_PUBLIC_INPUTS],
        fee: u64,
    ) -> Result<()> {
        instructions::withdraw::handler(ctx, proof_a, proof_b, proof_c, public_inputs, fee)
    }

    // ── Hidden-amount shielded pool (Option B) ──

    pub fn init_shielded(ctx: Context<InitShielded>, shielded_id: u64) -> Result<()> {
        instructions::init_shielded::handler(ctx, shielded_id)
    }

    pub fn publish_shielded_root(
        ctx: Context<UpdateShieldedRoot>,
        new_root: [u8; 32],
    ) -> Result<()> {
        instructions::publish_shielded_root::handler(ctx, new_root)
    }

    pub fn transact(
        ctx: Context<Transact>,
        proof_a: [u8; 64],
        proof_b: [u8; 128],
        proof_c: [u8; 64],
        public_inputs: [[u8; 32]; TX_NUM_PUBLIC_INPUTS],
        ext_amount: i64,
        fee: u64,
    ) -> Result<()> {
        instructions::transact::handler(ctx, proof_a, proof_b, proof_c, public_inputs, ext_amount, fee)
    }
}

#[cfg(test)]
mod groth16_tests {
    use super::test_vectors::{PROOF_A, PROOF_B, PROOF_C, PUBLIC_INPUTS};
    use super::verifying_key::VERIFYINGKEY;
    use groth16_solana::groth16::Groth16Verifier;

    #[test]
    fn verifies_real_proof() {
        let mut v =
            Groth16Verifier::new(&PROOF_A, &PROOF_B, &PROOF_C, &PUBLIC_INPUTS, &VERIFYINGKEY)
                .unwrap();
        assert!(v.verify().unwrap());
    }

    #[test]
    fn rejects_tampered_public_input() {
        let mut bad = PUBLIC_INPUTS;
        bad[1][31] ^= 1;
        let mut v =
            Groth16Verifier::new(&PROOF_A, &PROOF_B, &PROOF_C, &bad, &VERIFYINGKEY).unwrap();
        assert!(v.verify().is_err());
    }
}
