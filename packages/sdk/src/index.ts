/**
 * Soteria SDK — privacy primitives for Solana.
 *
 *   zk           Selective disclosure: prove membership/eligibility without
 *                revealing which identity. (mainnet-ready)
 *   stealth      One-time receive addresses so a main wallet isn't exposed.
 *                (mainnet-ready)
 *   confidential Token-2022 confidential amounts with an auditor key.
 *                (verified end-to-end on devnet via ConfidentialClient)
 *
 * No module pools funds or breaks the sender->recipient link. Every privacy
 * feature keeps a disclosure/audit path.
 */
export * as zk from "./zk";
export * as stealth from "./stealth";
export * as confidential from "./confidential";
