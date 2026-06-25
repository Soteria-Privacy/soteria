use anchor_lang::prelude::*;

use crate::constants::SHIELDED_SEED;
use crate::error::SoteriaError;
use crate::events::ShieldedRootPublished;
use crate::state::Shielded;

#[derive(Accounts)]
pub struct UpdateShieldedRoot<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [SHIELDED_SEED, &shielded.shielded_id.to_le_bytes()],
        bump = shielded.bump,
        has_one = authority,
    )]
    pub shielded: Box<Account<'info, Shielded>>,
}

/// Operator publishes the commitment-tree root after inserting the output
/// commitments emitted by `transact`. Recent roots ring-buffer so in-flight
/// proofs survive an update.
pub fn handler(ctx: Context<UpdateShieldedRoot>, new_root: [u8; 32]) -> Result<()> {
    require!(new_root != [0u8; 32], SoteriaError::ZeroRoot);

    let s = &mut ctx.accounts.shielded;
    s.push_root(new_root);

    emit!(ShieldedRootPublished {
        shielded_id: s.shielded_id,
        root: new_root,
        index: s.current_root_index,
    });
    Ok(())
}
