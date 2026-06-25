import { Router } from "express";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import type { AppDeps } from "../app.js";
import { AppError, asyncHandler } from "../middleware/error.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

// Operator-run confidential-transfer demo. The kit/zk-sdk (web3.js v2) stack is
// imported lazily so it never loads at server start — only when invoked.
//
// The operator pays fees and acts as the sender (Alice); a fresh recipient (Bob)
// is generated per call. Both owners derive their ElGamal/AES keys from their
// own signatures (the production-recoverable pattern), then a real confidential
// transfer runs on devnet and we report that the amount is hidden on-chain yet
// decryptable by the recipient.
export function confidentialRoutes(_deps: AppDeps): Router {
  const r = Router();

  r.post(
    "/confidential/demo",
    asyncHandler(async (req, res) => {
      if (!config.AUTHORITY_SECRET_KEY) {
        throw new AppError(503, "authority keypair not configured", "authority_disabled");
      }
      const DECIMALS = 2;
      const MINT_AMOUNT = 1000n; // 10.00 minted to the sender
      const requested = Number(req.body?.amount ?? 250);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new AppError(400, "amount must be a positive number", "bad_amount");
      }
      const amount = BigInt(Math.min(Math.floor(requested), Number(MINT_AMOUNT)));

      const sdk = await import("@soteria1/sdk");
      const {
        ConfidentialClient,
        deriveAccountKeys,
        elGamalPubkeyToAddress,
        ElGamalKeypair,
      } = sdk.confidential;
      const kit = await import("@solana/kit");

      // Operator = fee payer + sender (Alice).
      const opSecret = bs58.decode(config.AUTHORITY_SECRET_KEY.trim());
      const payer = await kit.createKeyPairSignerFromBytes(opSecret);
      const signAlice = (m: Uint8Array) => ed25519.sign(m, opSecret.slice(0, 32));

      // Fresh recipient (Bob).
      const bobSeed = ed25519.utils.randomPrivateKey();
      const bobSecret = new Uint8Array(64);
      bobSecret.set(bobSeed);
      bobSecret.set(ed25519.getPublicKey(bobSeed), 32);
      const bob = await kit.createKeyPairSignerFromBytes(bobSecret);
      const signBob = (m: Uint8Array) => ed25519.sign(m, bobSeed);

      const client = new ConfidentialClient({ rpcUrl: config.SOLANA_RPC_URL, payer });
      const mintSigner = await kit.generateKeyPairSigner();
      const auditor = new ElGamalKeypair();
      const auditorPub = elGamalPubkeyToAddress(auditor);

      logger.info("confidential demo: starting");
      const mint = await client.createMint({
        mint: mintSigner,
        decimals: DECIMALS,
        mintAuthority: payer,
        auditorElGamalPubkey: auditorPub,
      });

      // Derive owner keys from signatures, bound to (owner, mint).
      const aliceKeys = await deriveAccountKeys({ sign: signAlice, owner: payer.address, mint });
      const bobKeys = await deriveAccountKeys({ sign: signBob, owner: bob.address, mint });

      const aliceATA = await client.configureAccount({
        owner: payer, mint, elgamalKeypair: aliceKeys.elgamalKeypair, aesKey: aliceKeys.aesKey,
      });
      const bobATA = await client.configureAccount({
        owner: bob, mint, elgamalKeypair: bobKeys.elgamalKeypair, aesKey: bobKeys.aesKey,
      });

      await client.mintTo({ mint, token: aliceATA, mintAuthority: payer, amount: MINT_AMOUNT });
      await client.deposit({ token: aliceATA, mint, authority: payer, amount: MINT_AMOUNT, decimals: DECIMALS });
      await client.applyPending({ token: aliceATA, authority: payer, elgamalKeypair: aliceKeys.elgamalKeypair, aesKey: aliceKeys.aesKey });

      logger.info("confidential demo: transferring");
      await client.transfer({
        source: aliceATA, destination: bobATA, mint, authority: payer, amount,
        sourceElgamalKeypair: aliceKeys.elgamalKeypair, sourceAesKey: aliceKeys.aesKey,
        auditorElGamalPubkey: auditorPub,
      });
      await client.applyPending({ token: bobATA, authority: bob, elgamalKeypair: bobKeys.elgamalKeypair, aesKey: bobKeys.aesKey });

      const onChainPublicAmount = await client.getPublicAmount(bobATA);
      const recipientDecrypted = await client.decryptAvailableBalance(bobATA, bobKeys.aesKey);
      logger.info("confidential demo: done");

      res.json({
        ok: true,
        mint,
        recipient: bob.address,
        recipientTokenAccount: bobATA,
        decimals: DECIMALS,
        amount: amount.toString(),
        onChainPublicAmount: onChainPublicAmount.toString(),
        recipientDecrypted: recipientDecrypted.toString(),
        auditorElGamalPubkey: auditorPub,
      });
    })
  );

  return r;
}
