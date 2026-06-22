import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
} from "@solana/spl-token";
import * as splToken from "@solana/spl-token";

/**
 * Confidential amounts via the Token-2022 Confidential Transfer extension.
 *
 * Hides transfer AMOUNTS and balances (not the transfer graph) using Twisted
 * ElGamal encryption + ZK proofs verified on-chain. A mint-level `auditor`
 * ElGamal key can decrypt amounts for compliance — that key is wired in here.
 *
 * ── Status ───────────────────────────────────────────────────────────────────
 * Solana's ZK ElGamal Proof program is currently DISABLED on mainnet/devnet
 * pending a security audit, so the proof-gated steps (deposit/apply/transfer/
 * withdraw) cannot execute on those clusters yet. You CAN run the full flow on a
 * local validator that clones the mainnet Token Extension program:
 *
 *   solana-test-validator -r \
 *     --clone-upgradeable-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
 *     --url https://api.mainnet.solana.com
 *
 * Proof generation for transfer/withdraw is most complete in the Rust
 * `spl-token-client` crate today; the deposit/apply path below is reachable
 * from JS. Treat the proof-gated methods as interfaces to fill against the Rust
 * client (or once the JS proof helpers land).
 */

export interface ConfidentialMintConfig {
  decimals: number;
  mintAuthority: PublicKey;
  /**
   * 32-byte ElGamal public key of the compliance auditor. When set, the auditor
   * can decrypt every confidential amount on this mint. Pass null only if you
   * have a deliberate reason to run without an auditor.
   */
  auditorElGamalPubkey: Uint8Array | null;
  autoApproveNewAccounts?: boolean; // default true
}

/** Create a Token-2022 mint with the confidential transfer extension + auditor. */
export async function createConfidentialMint(
  connection: Connection,
  payer: Keypair,
  cfg: ConfidentialMintConfig
): Promise<PublicKey> {
  // Resolved at call time: not every @solana/spl-token build ships the
  // ConfidentialTransfer instructions yet.
  const createInitConfidentialIx = (splToken as Record<string, unknown>)
    .createInitializeConfidentialTransferMintInstruction as
    | ((...args: unknown[]) => import("@solana/web3.js").TransactionInstruction)
    | undefined;
  if (!createInitConfidentialIx) {
    throw new Error(
      "confidential transfer is unavailable in this @solana/spl-token build"
    );
  }

  const mint = Keypair.generate();
  const extensions = [ExtensionType.ConfidentialTransferMint];
  const space = getMintLen(extensions);
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitConfidentialIx(
      mint.publicKey,
      cfg.mintAuthority,
      cfg.autoApproveNewAccounts ?? true,
      cfg.auditorElGamalPubkey ?? undefined,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      cfg.decimals,
      cfg.mintAuthority,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer, mint]);
  return mint.publicKey;
}

/**
 * The remaining steps are proof-gated. They are defined here as the public
 * surface of the module; implement against spl-token-client (Rust) or the JS
 * proof helpers once available. Each returns the on-chain flow it represents.
 */
export interface ConfidentialAccountSetup {
  /** Configure a token account for confidential transfers (ElGamal + AES keys). */
  configureAccount(owner: Keypair, mint: PublicKey): Promise<PublicKey>;
}

export interface ConfidentialOps {
  /** Public balance -> confidential PENDING balance. (reachable from JS) */
  deposit(owner: Keypair, account: PublicKey, amount: bigint): Promise<string>;
  /** Move PENDING -> AVAILABLE so funds are spendable confidentially. */
  applyPendingBalance(owner: Keypair, account: PublicKey): Promise<string>;
  /** Confidential transfer (amount hidden). PROOF-GATED. */
  transfer(
    owner: Keypair,
    source: PublicKey,
    destination: PublicKey,
    amount: bigint
  ): Promise<string>;
  /** Confidential AVAILABLE balance -> public balance. PROOF-GATED. */
  withdraw(owner: Keypair, account: PublicKey, amount: bigint): Promise<string>;
}
