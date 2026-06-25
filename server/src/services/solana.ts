import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
// Under ESM, `anchor.BN` is undefined — it's only on the CJS default export.
const { BN } = anchor.default ?? anchor;
import bs58 from "bs58";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { be32, type FormattedProof, type FormattedPoolProof } from "./proof.js";

// groth16 pairing exceeds the 200k default; provision headroom.
const VERIFY_COMPUTE_UNITS = 400_000;

const idlPath = fileURLToPath(new URL("../idl/soteria_verifier.json", import.meta.url));
const IDL = JSON.parse(readFileSync(idlPath, "utf8"));

function loadKeypair(secret: string | undefined, label: string): Keypair | null {
  if (!secret) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(secret.trim()));
  } catch (err) {
    logger.error({ err }, `failed to load ${label} keypair`);
    return null;
  }
}

function u64le(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

export class SolanaService {
  readonly programId: PublicKey;
  private connection: Connection;
  private program: anchor.Program;
  private authority: Keypair | null;
  private relayer: Keypair | null;

  constructor() {
    this.programId = new PublicKey(config.SOTERIA_PROGRAM_ID);
    this.connection = new Connection(config.SOLANA_RPC_URL, "confirmed");
    this.authority = loadKeypair(config.AUTHORITY_SECRET_KEY, "authority");
    this.relayer = loadKeypair(config.RELAYER_SECRET_KEY, "relayer");

    // A read-only provider is enough to build instructions / decode accounts;
    // we sign and send transactions explicitly with the right keypair.
    const wallet = new anchor.Wallet(this.relayer ?? this.authority ?? Keypair.generate());
    const provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    this.program = new anchor.Program({ ...IDL, address: this.programId.toBase58() }, provider);
  }

  get canPublishRoot(): boolean {
    return this.authority !== null;
  }
  get canRelay(): boolean {
    return this.relayer !== null;
  }

  groupPda(groupId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("group"), u64le(groupId)],
      this.programId
    )[0];
  }

  nullifierPda(groupId: number, nullifierHash: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("nullifier"), u64le(groupId), Buffer.from(nullifierHash)],
      this.programId
    )[0];
  }

  async groupExists(groupId: number): Promise<boolean> {
    const info = await this.connection.getAccountInfo(this.groupPda(groupId));
    return info !== null;
  }

  private async send(ixs: TransactionInstruction[], signer: Keypair): Promise<string> {
    const tx = new Transaction().add(...ixs);
    return sendAndConfirmTransaction(this.connection, tx, [signer], {
      commitment: "confirmed",
    });
  }

  async createGroup(groupId: number): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .createGroup(new BN(groupId))
      .accounts({ authority: this.authority.publicKey, group: this.groupPda(groupId) })
      .instruction();
    return this.send([ix], this.authority);
  }

  async publishRoot(groupId: number, root: string): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .publishRoot(be32(root))
      .accounts({ authority: this.authority.publicKey, group: this.groupPda(groupId) })
      .instruction();
    return this.send([ix], this.authority);
  }

  async verifyProof(groupId: number, p: FormattedProof): Promise<string> {
    if (!this.relayer) throw new Error("relayer keypair not configured");
    const ix = await this.program.methods
      .verifyProof(p.externalNullifier, p.proofA, p.proofB, p.proofC, p.publicInputs)
      .accounts({
        payer: this.relayer.publicKey,
        group: this.groupPda(groupId),
        nullifier: this.nullifierPda(groupId, p.nullifierHash),
      })
      .instruction();
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: VERIFY_COMPUTE_UNITS });
    return this.send([cu, ix], this.relayer);
  }

  // ── Privacy pool (path C) ──

  poolPda(poolId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), u64le(poolId)],
      this.programId
    )[0];
  }

  vaultPda(poolId: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), u64le(poolId)],
      this.programId
    )[0];
  }

  poolNullifierPda(poolId: number, nullifierHash: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("pool_null"), this.poolPda(poolId).toBuffer(), Buffer.from(nullifierHash)],
      this.programId
    )[0];
  }

  commitmentPda(poolId: number, commitment: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("commit"), this.poolPda(poolId).toBuffer(), Buffer.from(commitment)],
      this.programId
    )[0];
  }

  async poolExists(poolId: number): Promise<boolean> {
    const info = await this.connection.getAccountInfo(this.poolPda(poolId));
    return info !== null;
  }

  /** True once a deposit has anchored this commitment on-chain. */
  async commitmentExists(poolId: number, commitment: string): Promise<boolean> {
    const info = await this.connection.getAccountInfo(
      this.commitmentPda(poolId, be32(commitment))
    );
    return info !== null;
  }

  async initPool(poolId: number, denomination: bigint): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .initPool(new BN(poolId), new BN(denomination.toString()))
      .accounts({
        authority: this.authority.publicKey,
        pool: this.poolPda(poolId),
        vault: this.vaultPda(poolId),
      })
      .instruction();
    return this.send([ix], this.authority);
  }

  async publishPoolRoot(poolId: number, root: string): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .publishPoolRoot(be32(root))
      .accounts({ authority: this.authority.publicKey, pool: this.poolPda(poolId) })
      .instruction();
    return this.send([ix], this.authority);
  }

  async setAssociationRoot(poolId: number, root: string): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .setAssociationRoot(be32(root))
      .accounts({ authority: this.authority.publicKey, pool: this.poolPda(poolId) })
      .instruction();
    return this.send([ix], this.authority);
  }

  async withdraw(
    poolId: number,
    recipient: PublicKey,
    fee: bigint,
    p: FormattedPoolProof
  ): Promise<string> {
    if (!this.relayer) throw new Error("relayer keypair not configured");
    const ix = await this.program.methods
      .withdraw(p.proofA, p.proofB, p.proofC, p.publicInputs, new BN(fee.toString()))
      .accounts({
        relayer: this.relayer.publicKey,
        pool: this.poolPda(poolId),
        vault: this.vaultPda(poolId),
        recipient,
        nullifier: this.poolNullifierPda(poolId, p.nullifierHash),
      })
      .instruction();
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: VERIFY_COMPUTE_UNITS });
    return this.send([cu, ix], this.relayer);
  }

  /**
   * Reconstruct every pool's deposit list from on-chain accounts so the operator
   * survives restarts (and re-adopts pools it never had in memory). Pool account
   * data = 8 disc + INIT_SPACE (1127) = 1135 bytes; Commitment = 8 + 49 = 57.
   * Commitments are ordered by their on-chain leaf_index.
   */
  async loadPools(): Promise<Map<number, { denomination: string; commitments: string[] }>> {
    const POOL_LEN = 1135;
    const COMMIT_LEN = 57;
    const [pools, commits] = await Promise.all([
      this.connection.getProgramAccounts(this.programId, { filters: [{ dataSize: POOL_LEN }] }),
      this.connection.getProgramAccounts(this.programId, { filters: [{ dataSize: COMMIT_LEN }] }),
    ]);

    const out = new Map<number, { denomination: string; commitments: string[] }>();
    for (const { account } of pools) {
      const d = account.data;
      const poolId = Number(d.readBigUInt64LE(40)); // 8 disc + 32 authority
      const denomination = d.readBigUInt64LE(48).toString();
      out.set(poolId, { denomination, commitments: [] });
    }

    const byPool = new Map<number, { leafIndex: number; commitment: string }[]>();
    for (const { account } of commits) {
      const d = account.data;
      const poolId = Number(d.readBigUInt64LE(8));
      let v = 0n;
      for (const b of d.subarray(16, 48)) v = (v << 8n) | BigInt(b); // 32-byte BE commitment
      const leafIndex = Number(d.readBigUInt64LE(48));
      (byPool.get(poolId) ?? byPool.set(poolId, []).get(poolId)!).push({
        leafIndex,
        commitment: v.toString(),
      });
    }
    for (const [poolId, arr] of byPool) {
      arr.sort((a, b) => a.leafIndex - b.leafIndex);
      const p = out.get(poolId);
      if (p) p.commitments = arr.map((x) => x.commitment);
    }
    return out;
  }

  // ── Hidden-amount shielded pool (Option B) ──

  get relayerPubkey(): string | null {
    return this.relayer?.publicKey.toBase58() ?? null;
  }

  shieldedPda(id: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("shielded"), u64le(id)],
      this.programId
    )[0];
  }
  shieldedVaultPda(id: number): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("shvault"), u64le(id)],
      this.programId
    )[0];
  }
  shieldedNullifierPda(id: number, nullifier: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("shnull"), this.shieldedPda(id).toBuffer(), Buffer.from(nullifier)],
      this.programId
    )[0];
  }

  async shieldedExists(id: number): Promise<boolean> {
    return (await this.connection.getAccountInfo(this.shieldedPda(id))) !== null;
  }

  async initShielded(id: number): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .initShielded(new BN(id))
      .accounts({
        authority: this.authority.publicKey,
        shielded: this.shieldedPda(id),
        vault: this.shieldedVaultPda(id),
      })
      .instruction();
    return this.send([ix], this.authority);
  }

  async publishShieldedRoot(id: number, root: string): Promise<string> {
    if (!this.authority) throw new Error("authority keypair not configured");
    const ix = await this.program.methods
      .publishShieldedRoot(be32(root))
      .accounts({ authority: this.authority.publicKey, shielded: this.shieldedPda(id) })
      .instruction();
    return this.send([ix], this.authority);
  }

  /** Relay a `transact` (withdraw or internal transfer): the relayer signs, so
   *  the spender's wallet never appears. The proof's extDataHash already bound
   *  the relayer pubkey, so `recipient`/`relayer` here must match it. */
  async relayTransact(
    id: number,
    p: {
      proofA: number[];
      proofB: number[];
      proofC: number[];
      publicInputs: number[][];
      extAmount: string;
      fee: string;
      nullifiers: number[][];
    },
    recipient: PublicKey
  ): Promise<string> {
    if (!this.relayer) throw new Error("relayer keypair not configured");
    const ix = await this.program.methods
      .transact(
        p.proofA,
        p.proofB,
        p.proofC,
        p.publicInputs,
        new BN(p.extAmount),
        new BN(p.fee)
      )
      .accounts({
        signer: this.relayer.publicKey,
        shielded: this.shieldedPda(id),
        vault: this.shieldedVaultPda(id),
        recipient,
        relayer: this.relayer.publicKey,
        nullifier1: this.shieldedNullifierPda(id, p.nullifiers[0]),
        nullifier2: this.shieldedNullifierPda(id, p.nullifiers[1]),
      })
      .instruction();
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: VERIFY_COMPUTE_UNITS });
    return this.send([cu, ix], this.relayer);
  }

  /** Confirm a client-signed deposit transaction exists and hit this program. */
  async transactionHitsProgram(signature: string): Promise<boolean> {
    const tx = await this.connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    if (!tx) return false;
    const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
    return keys.includes(this.programId.toBase58());
  }
}
