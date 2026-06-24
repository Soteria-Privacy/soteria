import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import type { AppDeps } from "../app.js";
import { AppError, asyncHandler } from "../middleware/error.js";
import { validate } from "../middleware/validate.js";
import { requireApiKey } from "../middleware/auth.js";
import {
  addCommitmentBody,
  createPoolBody,
  poolIdParam,
  poolWithdrawBody,
  setAssociationBody,
} from "../schemas.js";
import { computeRoot } from "../services/merkle.js";
import { formatPoolProof } from "../services/proof.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

// In-memory operator state: mirrors the on-chain deposit tree and curated
// association set so clients can rebuild Merkle paths. v1 only — a production
// deployment should persist this and rebuild it from on-chain Deposited events.
interface PoolState {
  denomination: string;
  deposits: string[];
  association: string[];
  depositRoot: string | null;
  associationRoot: string | null;
}

class PoolStore {
  private pools = new Map<number, PoolState>();

  create(id: number, denomination: string): PoolState {
    const state: PoolState = {
      denomination,
      deposits: [],
      association: [],
      depositRoot: null,
      associationRoot: null,
    };
    this.pools.set(id, state);
    return state;
  }

  get(id: number): PoolState | undefined {
    return this.pools.get(id);
  }
}

export function poolRoutes({ solana }: AppDeps): Router {
  const r = Router();
  const store = new PoolStore();

  const requireAuthority = () => {
    if (!solana || !solana.canPublishRoot) {
      throw new AppError(503, "authority keypair not configured", "authority_disabled");
    }
    return solana;
  };

  const requirePool = (id: number): PoolState => {
    const pool = store.get(id);
    if (!pool) throw new AppError(404, "pool not found", "not_found");
    return pool;
  };

  // Admin: create the on-chain pool and start mirroring its tree.
  r.post(
    "/pools",
    requireApiKey,
    validate({ body: createPoolBody }),
    asyncHandler(async (req, res) => {
      const svc = requireAuthority();
      const { poolId, denomination } = req.body as { poolId: number; denomination: string };
      if (await svc.poolExists(poolId)) {
        throw new AppError(409, "pool already exists on-chain", "duplicate");
      }
      const signature = await svc.initPool(poolId, BigInt(denomination));
      store.create(poolId, denomination);
      res.status(201).json({
        ok: true,
        poolId,
        poolPda: svc.poolPda(poolId).toBase58(),
        vaultPda: svc.vaultPda(poolId).toBase58(),
        denomination,
        signature,
      });
    })
  );

  // Tree state so a client can rebuild its withdraw witness.
  r.get(
    "/pools/:id",
    validate({ params: poolIdParam }),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pool = requirePool(id);
      res.json({
        poolId: id,
        denomination: pool.denomination,
        deposits: pool.deposits,
        association: pool.association,
        depositRoot: pool.depositRoot,
        associationRoot: pool.associationRoot,
        // Privacy context: how big the crowd you'd hide in is, and the floor the
        // operator enforces before allowing a withdrawal.
        anonymitySet: pool.deposits.length,
        minAnonymitySet: config.POOL_MIN_ANONYMITY_SET,
      });
    })
  );

  // Record a commitment after its deposit landed on-chain. The on-chain
  // Commitment PDA is the source of truth; we refuse to mirror a commitment
  // that isn't actually backed by a deposit.
  r.post(
    "/pools/:id/commitments",
    validate({ params: poolIdParam, body: addCommitmentBody }),
    asyncHandler(async (req, res) => {
      const id = Number(req.params.id);
      const pool = requirePool(id);
      const commitment = req.body.commitment as string;

      if (pool.deposits.includes(commitment)) {
        throw new AppError(409, "commitment already recorded", "duplicate");
      }
      if (solana && !(await solana.commitmentExists(id, commitment))) {
        throw new AppError(409, "commitment is not anchored by an on-chain deposit", "no_deposit");
      }

      const index = pool.deposits.length;
      pool.deposits.push(commitment);
      pool.depositRoot = await computeRoot(pool.deposits);
      res.status(201).json({ ok: true, index, depositRoot: pool.depositRoot });
    })
  );

  // Admin: publish the current deposit root into the on-chain ring buffer.
  r.post(
    "/pools/:id/publish",
    requireApiKey,
    validate({ params: poolIdParam }),
    asyncHandler(async (req, res) => {
      const svc = requireAuthority();
      const id = Number(req.params.id);
      const pool = requirePool(id);
      if (!pool.depositRoot) throw new AppError(409, "pool has no deposits yet", "no_root");
      const signature = await svc.publishPoolRoot(id, pool.depositRoot);
      res.json({ ok: true, poolId: id, depositRoot: pool.depositRoot, signature });
    })
  );

  // Admin: set the curated association set (compliance gate) and publish its
  // root on-chain. Omit `commitments` for a non-gated pool (all deposits).
  r.post(
    "/pools/:id/association",
    requireApiKey,
    validate({ params: poolIdParam, body: setAssociationBody }),
    asyncHandler(async (req, res) => {
      const svc = requireAuthority();
      const id = Number(req.params.id);
      const pool = requirePool(id);
      const requested = (req.body.commitments as string[] | undefined) ?? pool.deposits;

      const unknown = requested.filter((c) => !pool.deposits.includes(c));
      if (unknown.length > 0) {
        throw new AppError(400, "association set has commitments with no deposit", "bad_set");
      }

      pool.association = requested;
      pool.associationRoot = await computeRoot(pool.association);
      const signature = await svc.setAssociationRoot(id, pool.associationRoot);
      res.json({
        ok: true,
        poolId: id,
        associationRoot: pool.associationRoot,
        memberCount: pool.association.length,
        signature,
      });
    })
  );

  // Relay a withdrawal: the relayer signs and pays fees, so the withdrawer's
  // own wallet never appears on-chain. Does not custody funds — the vault pays
  // the recipient bound into the proof.
  r.post(
    "/pools/:id/withdraw",
    validate({ params: poolIdParam, body: poolWithdrawBody }),
    asyncHandler(async (req, res) => {
      if (!solana || !solana.canRelay) {
        throw new AppError(503, "relayer keypair not configured", "relay_disabled");
      }
      const id = Number(req.params.id);
      const pool = requirePool(id);

      // Anonymity-set guard: a withdrawal from a pool that barely has any
      // deposits trivially links back to the depositor. Refuse below the floor.
      if (pool.deposits.length < config.POOL_MIN_ANONYMITY_SET) {
        throw new AppError(
          409,
          `anonymity set too small (${pool.deposits.length}/${config.POOL_MIN_ANONYMITY_SET}); wait for more deposits`,
          "anonymity_set_too_small"
        );
      }

      const { recipient, fee, proof, publicSignals } = req.body;

      const formatted = formatPoolProof(proof, publicSignals);
      let signature: string;
      try {
        signature = await solana.withdraw(
          id,
          new PublicKey(recipient),
          BigInt(fee),
          formatted
        );
      } catch (err) {
        const msg = String((err as Error)?.message ?? err);
        logger.warn({ err: msg, poolId: id }, "withdraw submission failed");
        if (/already in use/i.test(msg)) {
          throw new AppError(409, "note already withdrawn", "spent");
        }
        if (/UnknownRoot/.test(msg)) {
          throw new AppError(400, "deposit root is not a known recent root", "unknown_root");
        }
        if (/UnknownAssociationRoot/.test(msg)) {
          throw new AppError(400, "association root does not match the pool", "bad_association");
        }
        if (/RecipientMismatch|FeeMismatch/.test(msg)) {
          throw new AppError(400, "proof bindings do not match recipient/fee", "binding_mismatch");
        }
        if (/ProofVerificationFailed|MalformedProof/.test(msg)) {
          throw new AppError(400, "proof failed verification", "invalid_proof");
        }
        throw new AppError(502, "on-chain submission failed", "submission_failed");
      }

      res.json({ ok: true, signature });
    })
  );

  return r;
}
