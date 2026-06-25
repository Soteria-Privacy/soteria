use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_lang::system_program;
use groth16_solana::groth16::Groth16Verifier;

use crate::constants::{
    FIELD_MODULUS_BE, SHIELDED_NULLIFIER_SEED, SHIELDED_SEED, SHIELDED_VAULT_SEED,
    TX_NUM_PUBLIC_INPUTS, PI_TX_EXT_DATA_HASH, PI_TX_NULLIFIER_1, PI_TX_NULLIFIER_2,
    PI_TX_OUT_COMMIT_1, PI_TX_OUT_COMMIT_2, PI_TX_PUBLIC_AMOUNT, PI_TX_ROOT,
};
use crate::error::SoteriaError;
use crate::events::Transacted;
use crate::state::{Shielded, ShieldedNullifier};
use crate::verifying_key_transaction::VERIFYINGKEY_TRANSACTION;

#[derive(Accounts)]
#[instruction(
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: [[u8; 32]; TX_NUM_PUBLIC_INPUTS],
    ext_amount: i64,
    fee: u64
)]
pub struct Transact<'info> {
    /// Depositor (deposit) or relayer (withdraw/transfer). Pays rent + gas.
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [SHIELDED_SEED, &shielded.shielded_id.to_le_bytes()],
        bump = shielded.bump,
    )]
    pub shielded: Box<Account<'info, Shielded>>,

    #[account(
        mut,
        seeds = [SHIELDED_VAULT_SEED, &shielded.shielded_id.to_le_bytes()],
        bump = shielded.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    /// Withdrawal destination; bound into the proof via extDataHash.
    /// CHECK: validated against the extDataHash binding.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// Fee destination; bound into the proof via extDataHash.
    /// CHECK: validated against the extDataHash binding.
    #[account(mut)]
    pub relayer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + ShieldedNullifier::INIT_SPACE,
        seeds = [SHIELDED_NULLIFIER_SEED, shielded.key().as_ref(), public_inputs[PI_TX_NULLIFIER_1].as_ref()],
        bump
    )]
    pub nullifier1: Box<Account<'info, ShieldedNullifier>>,

    #[account(
        init,
        payer = signer,
        space = 8 + ShieldedNullifier::INIT_SPACE,
        seeds = [SHIELDED_NULLIFIER_SEED, shielded.key().as_ref(), public_inputs[PI_TX_NULLIFIER_2].as_ref()],
        bump
    )]
    pub nullifier2: Box<Account<'info, ShieldedNullifier>>,

    pub system_program: Program<'info, System>,
}

// publicAmount = (ext_amount - fee) mod p, big-endian. Positive deposits sit in
// the low bytes; negative (withdrawals) wrap to p - |value|.
fn expected_public_amount(ext_amount: i64, fee: u64) -> [u8; 32] {
    let value: i128 = ext_amount as i128 - fee as i128;
    if value >= 0 {
        let mut out = [0u8; 32];
        out[16..32].copy_from_slice(&(value as u128).to_be_bytes());
        out
    } else {
        field_sub_u128(FIELD_MODULUS_BE, (-value) as u128)
    }
}

// p - mag (big-endian 32-byte minus a u128 magnitude); assumes p >= mag.
fn field_sub_u128(p: [u8; 32], mag: u128) -> [u8; 32] {
    let mut res = p;
    let mag_bytes = mag.to_be_bytes(); // 16 bytes
    let mut borrow: i32 = 0;
    for i in 0..16 {
        let d = res[31 - i] as i32 - mag_bytes[15 - i] as i32 - borrow;
        if d < 0 {
            res[31 - i] = (d + 256) as u8;
            borrow = 1;
        } else {
            res[31 - i] = d as u8;
            borrow = 0;
        }
    }
    let mut idx = 16;
    while borrow != 0 && idx < 32 {
        let d = res[31 - idx] as i32 - borrow;
        if d < 0 {
            res[31 - idx] = (d + 256) as u8;
            borrow = 1;
        } else {
            res[31 - idx] = d as u8;
            borrow = 0;
        }
        idx += 1;
    }
    res
}

// keccak(recipient || relayer || ext_amount_le || fee_le), masked below the
// field modulus. Binds the payout so a relayer cannot re-target it.
fn ext_data_hash(recipient: &Pubkey, relayer: &Pubkey, ext_amount: i64, fee: u64) -> [u8; 32] {
    let mut data = Vec::with_capacity(80);
    data.extend_from_slice(&recipient.to_bytes());
    data.extend_from_slice(&relayer.to_bytes());
    data.extend_from_slice(&ext_amount.to_le_bytes());
    data.extend_from_slice(&fee.to_le_bytes());
    let mut h = keccak::hash(&data).to_bytes();
    h[0] &= 0x1f;
    h
}

pub fn handler(
    ctx: Context<Transact>,
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    public_inputs: [[u8; 32]; TX_NUM_PUBLIC_INPUTS],
    ext_amount: i64,
    fee: u64,
) -> Result<()> {
    let shielded = &ctx.accounts.shielded;

    // root must be known (or the very first deposit, when no root exists yet and
    // all inputs are dummies referencing a zero root).
    let root = public_inputs[PI_TX_ROOT];
    require!(
        shielded.root_count == 0 || shielded.is_known_root(&root),
        SoteriaError::UnknownRoot
    );

    require!(
        public_inputs[PI_TX_PUBLIC_AMOUNT] == expected_public_amount(ext_amount, fee),
        SoteriaError::PublicAmountMismatch
    );

    require!(
        public_inputs[PI_TX_EXT_DATA_HASH]
            == ext_data_hash(
                &ctx.accounts.recipient.key(),
                &ctx.accounts.relayer.key(),
                ext_amount,
                fee
            ),
        SoteriaError::ExtDataHashMismatch
    );

    require!(
        public_inputs[PI_TX_NULLIFIER_1] != public_inputs[PI_TX_NULLIFIER_2],
        SoteriaError::DuplicateNullifier
    );

    let mut verifier =
        Groth16Verifier::new(&proof_a, &proof_b, &proof_c, &public_inputs, &VERIFYINGKEY_TRANSACTION)
            .map_err(|_| SoteriaError::MalformedProof)?;
    require!(
        verifier.verify().map_err(|_| SoteriaError::ProofVerificationFailed)?,
        SoteriaError::ProofVerificationFailed
    );

    // ── value movement ──
    let shielded_id = shielded.shielded_id.to_le_bytes();
    let vault_seeds: &[&[u8]] = &[SHIELDED_VAULT_SEED, shielded_id.as_ref(), &[shielded.vault_bump]];
    let signer_seeds = &[vault_seeds];

    if ext_amount > 0 {
        // deposit: signer funds the vault
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            ext_amount as u64,
        )?;
    } else if ext_amount < 0 {
        // withdrawal: vault pays the recipient
        let amount = (-ext_amount) as u64;
        require!(
            ctx.accounts.vault.lamports() >= amount + fee,
            SoteriaError::InsufficientVault
        );
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
        )?;
    }

    if fee > 0 {
        system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.relayer.to_account_info(),
                },
                signer_seeds,
            ),
            fee,
        )?;
    }

    // ── record state ──
    let nullifier1 = &mut ctx.accounts.nullifier1;
    nullifier1.shielded_id = shielded.shielded_id;
    nullifier1.nullifier_hash = public_inputs[PI_TX_NULLIFIER_1];
    nullifier1.bump = ctx.bumps.nullifier1;

    let nullifier2 = &mut ctx.accounts.nullifier2;
    nullifier2.shielded_id = shielded.shielded_id;
    nullifier2.nullifier_hash = public_inputs[PI_TX_NULLIFIER_2];
    nullifier2.bump = ctx.bumps.nullifier2;

    let shielded = &mut ctx.accounts.shielded;
    let leaf_index_start = shielded.num_commitments;
    shielded.num_commitments += 2;

    emit!(Transacted {
        shielded_id: shielded.shielded_id,
        nullifiers: [public_inputs[PI_TX_NULLIFIER_1], public_inputs[PI_TX_NULLIFIER_2]],
        output_commitments: [public_inputs[PI_TX_OUT_COMMIT_1], public_inputs[PI_TX_OUT_COMMIT_2]],
        leaf_index_start,
    });
    Ok(())
}
