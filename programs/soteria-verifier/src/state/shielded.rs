use anchor_lang::prelude::*;

use crate::constants::ROOT_HISTORY_SIZE;

/// A hidden-amount shielded pool (Option B). Unlike `Pool` there is no fixed
/// denomination — all value lives as encrypted note commitments in one tree, and
/// a single vault holds the pooled SOL. The tree is operator-maintained (v1):
/// the operator inserts output commitments from `Transacted` events and
/// publishes roots here.
#[account]
#[derive(InitSpace)]
pub struct Shielded {
    pub authority: Pubkey,
    pub shielded_id: u64,
    pub depth: u8,
    /// Total output commitments inserted; also the next leaf index.
    pub num_commitments: u64,
    pub root_count: u64,
    pub current_root_index: u32,
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],
    pub bump: u8,
    pub vault_bump: u8,
}

impl Shielded {
    pub fn push_root(&mut self, new_root: [u8; 32]) {
        if self.root_count > 0 {
            self.current_root_index =
                (self.current_root_index + 1) % ROOT_HISTORY_SIZE as u32;
        }
        self.roots[self.current_root_index as usize] = new_root;
        self.root_count += 1;
    }

    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        if *root == [0u8; 32] {
            return false;
        }
        let known = self.root_count.min(ROOT_HISTORY_SIZE as u64) as usize;
        let mut i = self.current_root_index as usize;
        for _ in 0..known {
            if self.roots[i] == *root {
                return true;
            }
            i = if i == 0 { ROOT_HISTORY_SIZE - 1 } else { i - 1 };
        }
        false
    }
}

/// Spent-note marker for the shielded pool. `init` fails on reuse → double-spend
/// protection. An empty tree (root_count == 0) accepts deposits whose inputs are
/// all dummies, so the first deposit still works.
#[account]
#[derive(InitSpace)]
pub struct ShieldedNullifier {
    pub shielded_id: u64,
    pub nullifier_hash: [u8; 32],
    pub bump: u8,
}
