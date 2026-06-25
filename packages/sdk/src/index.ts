/**
 * Soteria SDK — privacy primitives for Solana.
 *
 *   zk           Selective disclosure: prove membership/eligibility without
 *                revealing which identity. (mainnet-ready)
 *   stealth      One-time receive addresses so a main wallet isn't exposed.
 *                (mainnet-ready)
 *   confidential Token-2022 confidential amounts with an auditor key.
 *                (verified end-to-end on devnet via ConfidentialClient)
 *   pool         Compliant fixed-denomination privacy pool: ZK deposit/withdraw
 *                that severs the on-chain link, gated by an association set and
 *                auditable via a curated root. (path C — needs setup-pool.sh)
 *   shielded     Hidden-amount UTXO pool (Option B): arbitrary amounts, partial
 *                spends, change, multi-recipient — values stay encrypted.
 *                (needs setup-transaction.sh; verified on devnet)
 *
 * Every privacy feature keeps a disclosure/audit path: the pool is gated by an
 * association set rather than being an unconditional tumbler.
 */
export * as zk from "./zk/index.js";
export * as stealth from "./stealth/index.js";
export * as confidential from "./confidential/index.js";
export * as pool from "./pool/index.js";
export * as shielded from "./shielded/index.js";
