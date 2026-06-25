use anchor_lang::prelude::*;

use crate::constants::{SHIELDED_SEED, SHIELDED_VAULT_SEED, TREE_DEPTH};
use crate::events::ShieldedCreated;
use crate::state::Shielded;

#[derive(Accounts)]
#[instruction(shielded_id: u64)]
pub struct InitShielded<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Shielded::INIT_SPACE,
        seeds = [SHIELDED_SEED, &shielded_id.to_le_bytes()],
        bump
    )]
    pub shielded: Box<Account<'info, Shielded>>,

    #[account(
        seeds = [SHIELDED_VAULT_SEED, &shielded_id.to_le_bytes()],
        bump
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitShielded>, shielded_id: u64) -> Result<()> {
    let s = &mut ctx.accounts.shielded;
    s.authority = ctx.accounts.authority.key();
    s.shielded_id = shielded_id;
    s.depth = TREE_DEPTH;
    s.bump = ctx.bumps.shielded;
    s.vault_bump = ctx.bumps.vault;

    emit!(ShieldedCreated {
        shielded_id,
        authority: s.authority,
    });
    Ok(())
}
