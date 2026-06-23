/**
 * Confidential amounts via the Token-2022 Confidential Transfer extension.
 *
 * Hides transfer AMOUNTS and balances (not the transfer graph) using twisted
 * ElGamal encryption + ZK proofs verified on-chain by Solana's ZK ElGamal Proof
 * program. A mint-level `auditor` ElGamal key can decrypt every amount for
 * compliance — wire it in via `createMint({ auditorElGamalPubkey })`.
 *
 * This module uses the @solana/kit (web3.js v2) stack internally because the
 * confidential-transfer instruction + proof helpers ship for it. Callers work
 * with plain values (base58 addresses, bigint amounts) and the zk-sdk key
 * objects; no kit knowledge is required.
 *
 * Proofs that exceed transaction size (transfer, withdraw) are verified into
 * dedicated context-state accounts, created and torn down automatically by the
 * underlying instruction-plan helpers.
 */
import {
  createSolanaRpc,
  createTransactionMessage,
  createTransactionPlanExecutor,
  createTransactionPlanner,
  getAddressDecoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  singleInstructionPlan,
  some,
  type Address,
  type InstructionPlan,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  extension,
  fetchToken,
  findAssociatedTokenPda,
  getConfidentialDepositInstruction,
  getCreateMintInstructionPlan,
  getMintToInstruction,
} from "@solana-program/token-2022";
import {
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getConfidentialTransferInstructionPlan,
  getConfidentialWithdrawInstructionPlan,
  getCreateConfidentialTransferAccountInstructionPlan,
} from "@solana-program/token-2022/confidential";
import { AeCiphertext, AeKey, ElGamalKeypair } from "@solana/zk-sdk/bundler";

export { AeKey, ElGamalKeypair };

/** Encode a 32-byte ElGamal public key as a base58 Address. */
export function elGamalPubkeyToAddress(keypair: ElGamalKeypair): Address {
  return getAddressDecoder().decode(keypair.pubkey().toBytes());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retry transient RPC failures (rate limits, network blips) with backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 8): Promise<T> {
  let delay = 500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message ?? err);
      const retriable =
        /429|Too Many Requests|fetch failed|ENOTFOUND|ETIMEDOUT|50[023]|socket|network/i.test(
          msg
        );
      if (!retriable || i === attempts - 1) throw err;
      await sleep(delay);
      delay = Math.min(delay * 2, 8_000);
    }
  }
  throw lastErr;
}

export interface ConfidentialClientConfig {
  /** Solana JSON-RPC HTTP endpoint, e.g. https://api.devnet.solana.com */
  rpcUrl: string;
  /** Fee payer; signs and pays for every transaction. */
  payer: KeyPairSigner;
}

export interface CreateMintParams {
  mint: KeyPairSigner;
  decimals: number;
  mintAuthority: TransactionSigner;
  /** Auditor ElGamal pubkey (compliance). Pass null to run without an auditor. */
  auditorElGamalPubkey?: Address | null;
  /** When true, accounts may transact immediately without authority approval. */
  autoApproveNewAccounts?: boolean;
}

export interface ConfigureAccountParams {
  owner: TransactionSigner;
  mint: Address;
  elgamalKeypair: ElGamalKeypair;
  aesKey: AeKey;
  maximumPendingBalanceCreditCounter?: number | bigint;
}

export interface DepositParams {
  token: Address;
  mint: Address;
  authority: TransactionSigner;
  amount: bigint;
  decimals: number;
}

export interface ApplyPendingParams {
  token: Address;
  authority: TransactionSigner;
  elgamalKeypair: ElGamalKeypair;
  aesKey: AeKey;
}

export interface TransferParams {
  source: Address;
  destination: Address;
  mint: Address;
  authority: TransactionSigner;
  amount: bigint;
  sourceElgamalKeypair: ElGamalKeypair;
  sourceAesKey: AeKey;
  auditorElGamalPubkey?: Address;
}

export interface WithdrawParams {
  token: Address;
  mint: Address;
  authority: TransactionSigner;
  amount: bigint;
  decimals: number;
  elgamalKeypair: ElGamalKeypair;
  aesKey: AeKey;
}

/**
 * A confidential-transfer client bound to one RPC endpoint and fee payer.
 * Each method submits the on-chain transaction(s) for one lifecycle step.
 */
export class ConfidentialClient {
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly payer: KeyPairSigner;
  private readonly planner: ReturnType<typeof createTransactionPlanner>;
  private readonly executor: ReturnType<typeof createTransactionPlanExecutor>;

  constructor(config: ConfidentialClientConfig) {
    const { rpcUrl, payer } = config;
    this.payer = payer;
    this.rpc = createSolanaRpc(rpcUrl);
    this.planner = createTransactionPlanner({
      createTransactionMessage: () =>
        pipe(createTransactionMessage({ version: 0 }), (m) =>
          setTransactionMessageFeePayerSigner(payer, m)
        ),
    });
    // Confirm via RPC polling rather than a WebSocket subscription: devnet WS
    // is flaky under the transfer's parallel proof sends, and polling works
    // identically in Node and the browser.
    this.executor = createTransactionPlanExecutor({
      executeTransactionMessage: async (_ctx, message) => {
        const { value: blockhash } = await withRetry(() =>
          this.rpc.getLatestBlockhash().send()
        );
        const signed = await signTransactionMessageWithSigners(
          setTransactionMessageLifetimeUsingBlockhash(blockhash, message)
        );
        const signature = getSignatureFromTransaction(signed);
        const wire = getBase64EncodedWireTransaction(signed);
        await withRetry(() =>
          this.rpc
            .sendTransaction(wire, {
              encoding: "base64",
              preflightCommitment: "confirmed",
            })
            .send()
        );
        await this.confirm(signature);
        return signature;
      },
    });
  }

  /** Poll signature status until confirmed (WebSocket-free). */
  private async confirm(signature: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await withRetry(() =>
        this.rpc
          .getSignatureStatuses([
            signature as Parameters<typeof this.rpc.getSignatureStatuses>[0][number],
          ])
          .send()
      );
      const status = value[0];
      if (status) {
        if (status.err) {
          throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return;
        }
      }
      await sleep(1_500);
    }
    throw new Error(`timed out confirming transaction ${signature}`);
  }

  private async run(plan: InstructionPlan): Promise<void> {
    await this.executor(await this.planner(plan));
  }

  /** Fetch a decoded token account, retrying transient RPC failures. */
  private async fetchTokenAccount(token: Address) {
    return (await withRetry(() => fetchToken(this.rpc, token))).data;
  }

  /** Associated token address for an owner on a given mint. */
  async associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
    const [pda] = await findAssociatedTokenPda({
      owner,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      mint,
    });
    return pda;
  }

  /** Create a Token-2022 mint with the confidential-transfer extension + auditor. */
  async createMint(params: CreateMintParams): Promise<Address> {
    const {
      mint,
      decimals,
      mintAuthority,
      auditorElGamalPubkey = null,
      autoApproveNewAccounts = true,
    } = params;
    await this.run(
      getCreateMintInstructionPlan({
        payer: this.payer,
        newMint: mint,
        decimals,
        mintAuthority,
        extensions: [
          extension("ConfidentialTransferMint", {
            authority: some(mintAuthority.address),
            autoApproveNewAccounts,
            auditorElgamalPubkey: auditorElGamalPubkey
              ? some(auditorElGamalPubkey)
              : null,
          }),
        ],
      })
    );
    return mint.address;
  }

  /**
   * Configure a token account for confidential transfers (creates the ATA,
   * reallocates, configures, and verifies the pubkey-validity proof).
   * Returns the associated token address.
   */
  async configureAccount(params: ConfigureAccountParams): Promise<Address> {
    const { owner, mint, elgamalKeypair, aesKey } = params;
    await this.run(
      await getCreateConfidentialTransferAccountInstructionPlan({
        payer: this.payer,
        owner,
        mint,
        rpc: this.rpc,
        elgamalKeypair,
        aesKey,
        maximumPendingBalanceCreditCounter:
          params.maximumPendingBalanceCreditCounter,
      })
    );
    return this.associatedTokenAddress(owner.address, mint);
  }

  /** Mint public (plaintext) tokens to a token account. */
  async mintTo(params: {
    mint: Address;
    token: Address;
    mintAuthority: TransactionSigner;
    amount: bigint;
  }): Promise<void> {
    await this.run(
      singleInstructionPlan(
        getMintToInstruction({
          mint: params.mint,
          token: params.token,
          mintAuthority: params.mintAuthority,
          amount: params.amount,
        })
      )
    );
  }

  /** Move a public balance into the encrypted pending balance. */
  async deposit(params: DepositParams): Promise<void> {
    await this.run(
      singleInstructionPlan(
        getConfidentialDepositInstruction({
          token: params.token,
          mint: params.mint,
          authority: params.authority,
          amount: params.amount,
          decimals: params.decimals,
        })
      )
    );
  }

  /** Move the encrypted pending balance into the spendable available balance. */
  async applyPending(params: ApplyPendingParams): Promise<void> {
    const account = await this.fetchTokenAccount(params.token);
    await this.run(
      singleInstructionPlan(
        getApplyConfidentialPendingBalanceInstructionFromToken({
          token: params.token,
          tokenAccount: account,
          authority: params.authority,
          elgamalSecretKey: params.elgamalKeypair.secret(),
          aesKey: params.aesKey,
        })
      )
    );
  }

  /** Confidentially transfer an amount between two accounts (amount hidden). */
  async transfer(params: TransferParams): Promise<void> {
    const sourceAccount = await this.fetchTokenAccount(params.source);
    const destinationAccount = await this.fetchTokenAccount(params.destination);
    await this.run(
      await getConfidentialTransferInstructionPlan({
        sourceToken: params.source,
        mint: params.mint,
        destinationToken: params.destination,
        sourceTokenAccount: sourceAccount,
        destinationTokenAccount: destinationAccount,
        auditorElgamalPubkey: params.auditorElGamalPubkey,
        authority: params.authority,
        amount: params.amount,
        sourceElgamalKeypair: params.sourceElgamalKeypair,
        aesKey: params.sourceAesKey,
        payer: this.payer,
        rpc: this.rpc,
      })
    );
  }

  /** Move an encrypted available balance back to a public (plaintext) balance. */
  async withdraw(params: WithdrawParams): Promise<void> {
    const account = await this.fetchTokenAccount(params.token);
    await this.run(
      await getConfidentialWithdrawInstructionPlan({
        token: params.token,
        mint: params.mint,
        tokenAccount: account,
        authority: params.authority,
        amount: params.amount,
        decimals: params.decimals,
        elgamalKeypair: params.elgamalKeypair,
        aesKey: params.aesKey,
        payer: this.payer,
        rpc: this.rpc,
      })
    );
  }

  /** The plaintext (public) token amount visible on-chain. */
  async getPublicAmount(token: Address): Promise<bigint> {
    return (await this.fetchTokenAccount(token)).amount;
  }

  /** Decrypt an account's available balance with its owner's AES key. */
  async decryptAvailableBalance(token: Address, aesKey: AeKey): Promise<bigint> {
    const account = await this.fetchTokenAccount(token);
    // `extensions` is a kit Option<Extension[]>; unwrap defensively (shape is
    // dynamic on-chain data, so we read it untyped).
    const raw = account.extensions as unknown as
      | { __option: "Some"; value: Array<Record<string, unknown>> }
      | { __option: "None" }
      | Array<Record<string, unknown>>
      | undefined;
    const list = Array.isArray(raw)
      ? raw
      : raw && raw.__option === "Some"
        ? raw.value
        : [];
    const ct = list.find((e) => e.__kind === "ConfidentialTransferAccount");
    if (!ct) {
      throw new Error("account is not configured for confidential transfers");
    }
    const cipher = AeCiphertext.fromBytes(
      Uint8Array.from(ct.decryptableAvailableBalance as ArrayLike<number>)
    );
    if (!cipher) throw new Error("failed to decode available-balance ciphertext");
    return aesKey.decrypt(cipher);
  }
}
