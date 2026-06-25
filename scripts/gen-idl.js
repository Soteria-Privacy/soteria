// Generate the Anchor 0.30 IDL for soteria_verifier directly, bypassing the
// broken host-side `anchor build` IDL generator (anchor-syn 0.30.1 + modern
// Rust/proc-macro2). Discriminators and type layouts mirror the program source.
//
//   node scripts/gen-idl.js > target/idl/soteria_verifier.json

const { createHash } = require("crypto");
const fs = require("fs");

const ADDRESS = "9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs";
const SYSTEM = "11111111111111111111111111111111";

const disc = (prefix, name) =>
  [...createHash("sha256").update(`${prefix}:${name}`).digest().subarray(0, 8)];

const u8arr = (n) => ({ array: ["u8", n] });
const bytes32 = u8arr(32);

const idl = {
  address: ADDRESS,
  metadata: {
    name: "soteria_verifier",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Groth16 selective-disclosure verifier with per-group root registry",
  },
  instructions: [
    {
      name: "create_group",
      discriminator: disc("global", "create_group"),
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "group", writable: true },
        { name: "system_program", address: SYSTEM },
      ],
      args: [{ name: "group_id", type: "u64" }],
    },
    {
      name: "publish_root",
      discriminator: disc("global", "publish_root"),
      accounts: [
        { name: "authority", signer: true },
        { name: "group", writable: true },
      ],
      args: [{ name: "new_root", type: bytes32 }],
    },
    {
      name: "set_authority",
      discriminator: disc("global", "set_authority"),
      accounts: [
        { name: "authority", signer: true },
        { name: "group", writable: true },
      ],
      args: [{ name: "new_authority", type: "pubkey" }],
    },
    {
      name: "verify_proof",
      discriminator: disc("global", "verify_proof"),
      accounts: [
        { name: "payer", writable: true, signer: true },
        { name: "group" },
        { name: "nullifier", writable: true },
        { name: "system_program", address: SYSTEM },
      ],
      args: [
        { name: "external_nullifier", type: bytes32 },
        { name: "proof_a", type: u8arr(64) },
        { name: "proof_b", type: u8arr(128) },
        { name: "proof_c", type: u8arr(64) },
        { name: "public_inputs", type: { array: [bytes32, 4] } },
      ],
    },
    // ── Privacy pool (path C) ──
    {
      name: "init_pool",
      discriminator: disc("global", "init_pool"),
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "pool", writable: true },
        { name: "vault" },
        { name: "system_program", address: SYSTEM },
      ],
      args: [
        { name: "pool_id", type: "u64" },
        { name: "denomination", type: "u64" },
      ],
    },
    {
      name: "deposit",
      discriminator: disc("global", "deposit"),
      accounts: [
        { name: "depositor", writable: true, signer: true },
        { name: "pool", writable: true },
        { name: "vault", writable: true },
        { name: "commitment_record", writable: true },
        { name: "system_program", address: SYSTEM },
      ],
      args: [{ name: "commitment", type: bytes32 }],
    },
    {
      name: "publish_pool_root",
      discriminator: disc("global", "publish_pool_root"),
      accounts: [
        { name: "authority", signer: true },
        { name: "pool", writable: true },
      ],
      args: [{ name: "new_root", type: bytes32 }],
    },
    {
      name: "set_association_root",
      discriminator: disc("global", "set_association_root"),
      accounts: [
        { name: "authority", signer: true },
        { name: "pool", writable: true },
      ],
      args: [{ name: "association_root", type: bytes32 }],
    },
    {
      name: "withdraw",
      discriminator: disc("global", "withdraw"),
      accounts: [
        { name: "relayer", writable: true, signer: true },
        { name: "pool" },
        { name: "vault", writable: true },
        { name: "recipient", writable: true },
        { name: "nullifier", writable: true },
        { name: "system_program", address: SYSTEM },
      ],
      args: [
        { name: "proof_a", type: u8arr(64) },
        { name: "proof_b", type: u8arr(128) },
        { name: "proof_c", type: u8arr(64) },
        { name: "public_inputs", type: { array: [bytes32, 6] } },
        { name: "fee", type: "u64" },
      ],
    },
    // ── Hidden-amount shielded pool (Option B) ──
    {
      name: "init_shielded",
      discriminator: disc("global", "init_shielded"),
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "shielded", writable: true },
        { name: "vault" },
        { name: "system_program", address: SYSTEM },
      ],
      args: [{ name: "shielded_id", type: "u64" }],
    },
    {
      name: "publish_shielded_root",
      discriminator: disc("global", "publish_shielded_root"),
      accounts: [
        { name: "authority", signer: true },
        { name: "shielded", writable: true },
      ],
      args: [{ name: "new_root", type: bytes32 }],
    },
    {
      name: "transact",
      discriminator: disc("global", "transact"),
      accounts: [
        { name: "signer", writable: true, signer: true },
        { name: "shielded", writable: true },
        { name: "vault", writable: true },
        { name: "recipient", writable: true },
        { name: "relayer", writable: true },
        { name: "nullifier1", writable: true },
        { name: "nullifier2", writable: true },
        { name: "system_program", address: SYSTEM },
      ],
      args: [
        { name: "proof_a", type: u8arr(64) },
        { name: "proof_b", type: u8arr(128) },
        { name: "proof_c", type: u8arr(64) },
        { name: "public_inputs", type: { array: [bytes32, 7] } },
        { name: "ext_amount", type: "i64" },
        { name: "fee", type: "u64" },
      ],
    },
  ],
  accounts: [
    { name: "Group", discriminator: disc("account", "Group") },
    { name: "NullifierRecord", discriminator: disc("account", "NullifierRecord") },
    { name: "Shielded", discriminator: disc("account", "Shielded") },
    { name: "ShieldedNullifier", discriminator: disc("account", "ShieldedNullifier") },
    { name: "Pool", discriminator: disc("account", "Pool") },
    { name: "Commitment", discriminator: disc("account", "Commitment") },
    { name: "PoolNullifier", discriminator: disc("account", "PoolNullifier") },
  ],
  events: [
    { name: "GroupCreated", discriminator: disc("event", "GroupCreated") },
    { name: "RootPublished", discriminator: disc("event", "RootPublished") },
    { name: "AuthorityChanged", discriminator: disc("event", "AuthorityChanged") },
    { name: "Disclosed", discriminator: disc("event", "Disclosed") },
    { name: "PoolCreated", discriminator: disc("event", "PoolCreated") },
    { name: "Deposited", discriminator: disc("event", "Deposited") },
    { name: "PoolRootPublished", discriminator: disc("event", "PoolRootPublished") },
    { name: "AssociationRootSet", discriminator: disc("event", "AssociationRootSet") },
    { name: "Withdrawn", discriminator: disc("event", "Withdrawn") },
    { name: "ShieldedCreated", discriminator: disc("event", "ShieldedCreated") },
    { name: "ShieldedRootPublished", discriminator: disc("event", "ShieldedRootPublished") },
    { name: "Transacted", discriminator: disc("event", "Transacted") },
  ],
  errors: [
    { code: 6000, name: "UnknownRoot", msg: "merkle root is not among the group's recent published roots" },
    { code: 6001, name: "ZeroRoot", msg: "merkle root cannot be zero" },
    { code: 6002, name: "MalformedProof", msg: "proof bytes are malformed" },
    { code: 6003, name: "ProofVerificationFailed", msg: "zero-knowledge proof failed verification" },
    { code: 6004, name: "InvalidAuthority", msg: "new authority cannot be the default pubkey" },
    { code: 6005, name: "ScopeMismatch", msg: "proof's external nullifier does not match the expected scope" },
    { code: 6006, name: "UnknownAssociationRoot", msg: "association root does not match the pool's curated set" },
    { code: 6007, name: "RecipientMismatch", msg: "proof's recipient binding does not match the recipient account" },
    { code: 6008, name: "FeeMismatch", msg: "proof's fee binding does not match the fee argument" },
    { code: 6009, name: "FeeTooHigh", msg: "fee exceeds the pool denomination" },
    { code: 6010, name: "ZeroDenomination", msg: "pool denomination must be non-zero" },
    { code: 6011, name: "PublicAmountMismatch", msg: "proof's publicAmount does not match the declared ext_amount/fee" },
    { code: 6012, name: "ExtDataHashMismatch", msg: "proof's extDataHash does not match the transaction's external data" },
    { code: 6013, name: "DuplicateNullifier", msg: "the two input nullifiers must differ" },
    { code: 6014, name: "InsufficientVault", msg: "vault has insufficient balance for this withdrawal" },
  ],
  types: [
    {
      name: "Group",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "pubkey" },
          { name: "group_id", type: "u64" },
          { name: "depth", type: "u8" },
          { name: "root_count", type: "u64" },
          { name: "current_root_index", type: "u32" },
          { name: "roots", type: { array: [bytes32, 32] } },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "NullifierRecord",
      type: {
        kind: "struct",
        fields: [
          { name: "group_id", type: "u64" },
          { name: "nullifier_hash", type: bytes32 },
          { name: "merkle_root", type: bytes32 },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "GroupCreated",
      type: {
        kind: "struct",
        fields: [
          { name: "group_id", type: "u64" },
          { name: "authority", type: "pubkey" },
        ],
      },
    },
    {
      name: "RootPublished",
      type: {
        kind: "struct",
        fields: [
          { name: "group_id", type: "u64" },
          { name: "root", type: bytes32 },
          { name: "index", type: "u32" },
        ],
      },
    },
    {
      name: "AuthorityChanged",
      type: {
        kind: "struct",
        fields: [
          { name: "group_id", type: "u64" },
          { name: "old_authority", type: "pubkey" },
          { name: "new_authority", type: "pubkey" },
        ],
      },
    },
    {
      name: "Disclosed",
      type: {
        kind: "struct",
        fields: [
          { name: "group_id", type: "u64" },
          { name: "nullifier_hash", type: bytes32 },
          { name: "merkle_root", type: bytes32 },
          { name: "external_nullifier", type: bytes32 },
          { name: "signal_hash", type: bytes32 },
        ],
      },
    },
    {
      name: "Pool",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "pubkey" },
          { name: "pool_id", type: "u64" },
          { name: "denomination", type: "u64" },
          { name: "depth", type: "u8" },
          { name: "num_commitments", type: "u64" },
          { name: "root_count", type: "u64" },
          { name: "current_root_index", type: "u32" },
          { name: "roots", type: { array: [bytes32, 32] } },
          { name: "association_root", type: bytes32 },
          { name: "bump", type: "u8" },
          { name: "vault_bump", type: "u8" },
        ],
      },
    },
    {
      name: "Commitment",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "commitment", type: bytes32 },
          { name: "leaf_index", type: "u64" },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "PoolNullifier",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "nullifier_hash", type: bytes32 },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "PoolCreated",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "authority", type: "pubkey" },
          { name: "denomination", type: "u64" },
        ],
      },
    },
    {
      name: "Deposited",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "commitment", type: bytes32 },
          { name: "leaf_index", type: "u64" },
        ],
      },
    },
    {
      name: "PoolRootPublished",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "root", type: bytes32 },
          { name: "index", type: "u32" },
        ],
      },
    },
    {
      name: "AssociationRootSet",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "association_root", type: bytes32 },
        ],
      },
    },
    {
      name: "Withdrawn",
      type: {
        kind: "struct",
        fields: [
          { name: "pool_id", type: "u64" },
          { name: "nullifier_hash", type: bytes32 },
          { name: "recipient", type: "pubkey" },
          { name: "fee", type: "u64" },
        ],
      },
    },
    {
      name: "Shielded",
      type: {
        kind: "struct",
        fields: [
          { name: "authority", type: "pubkey" },
          { name: "shielded_id", type: "u64" },
          { name: "depth", type: "u8" },
          { name: "num_commitments", type: "u64" },
          { name: "root_count", type: "u64" },
          { name: "current_root_index", type: "u32" },
          { name: "roots", type: { array: [bytes32, 32] } },
          { name: "bump", type: "u8" },
          { name: "vault_bump", type: "u8" },
        ],
      },
    },
    {
      name: "ShieldedNullifier",
      type: {
        kind: "struct",
        fields: [
          { name: "shielded_id", type: "u64" },
          { name: "nullifier_hash", type: bytes32 },
          { name: "bump", type: "u8" },
        ],
      },
    },
    {
      name: "ShieldedCreated",
      type: {
        kind: "struct",
        fields: [
          { name: "shielded_id", type: "u64" },
          { name: "authority", type: "pubkey" },
        ],
      },
    },
    {
      name: "ShieldedRootPublished",
      type: {
        kind: "struct",
        fields: [
          { name: "shielded_id", type: "u64" },
          { name: "root", type: bytes32 },
          { name: "index", type: "u32" },
        ],
      },
    },
    {
      name: "Transacted",
      type: {
        kind: "struct",
        fields: [
          { name: "shielded_id", type: "u64" },
          { name: "nullifiers", type: { array: [bytes32, 2] } },
          { name: "output_commitments", type: { array: [bytes32, 2] } },
          { name: "leaf_index_start", type: "u64" },
        ],
      },
    },
  ],
};

process.stdout.write(JSON.stringify(idl, null, 2));
