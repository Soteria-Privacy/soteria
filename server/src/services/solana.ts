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
import { be32, type FormattedProof } from "./proof.js";

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
}
