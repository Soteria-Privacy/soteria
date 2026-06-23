import { ed25519 } from "@noble/curves/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToNumberLE, numberToBytesLE } from "@noble/curves/abstract/utils";
import { PublicKey } from "@solana/web3.js";

/**
 * Dual-key stealth addresses for Solana (ERC-5564 style, adapted to ed25519).
 *
 * A recipient publishes a META-ADDRESS made of two public keys:
 *   - spend public key  S = s*G   (controls spending)
 *   - view public key    V = v*G   (lets the recipient scan cheaply)
 *
 * A sender, knowing (S, V), derives a fresh one-time stealth address per payment
 * and publishes only an ephemeral public key R. Nobody watching the chain can
 * link the stealth address back to the recipient's meta-address.
 *
 * This module hides WHICH wallet receives. It is not a mixer: funds are not
 * pooled, and there is no deposit/withdraw that breaks the sender->recipient link.
 *
 * ── Spending caveat (read this) ──────────────────────────────────────────────
 * The one-time signing key is a raw scalar `p = (s + tweak) mod L`. Solana's
 * standard Keypair derives its scalar by hashing a 32-byte seed, so you CANNOT
 * load `p` into a normal web3.js Keypair and sign. Spending requires raw-scalar
 * ed25519 signing (Monero-style). `signWithStealthScalar` below does that; wire
 * it into a custom transaction signer when you build the claim flow.
 */

const L = ed25519.CURVE.n; // group order
const Base = ed25519.ExtendedPoint.BASE;

export interface MetaAddress {
  spendPub: Uint8Array; // 32-byte compressed point
  viewPub: Uint8Array;
}

export interface StealthKeys {
  spendScalar: bigint; // s  (keep secret)
  viewScalar: bigint; // v  (keep secret; can be shared with a scanning service)
  meta: MetaAddress;
}

export interface StealthOutput {
  stealthPub: Uint8Array; // one-time public key (compressed point)
  stealthAddress: PublicKey; // same bytes, as a Solana address
  ephemeralPub: Uint8Array; // R — publish this in an announcement
  viewTag: number; // 1 byte, lets scanners skip non-matches fast
}

function hashToScalar(...chunks: Uint8Array[]): bigint {
  const h = sha512(concat(chunks));
  return bytesToNumberLE(h) % L;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Generate a recipient's stealth key material + shareable meta-address. */
export function generateStealthKeys(): StealthKeys {
  const s = bytesToNumberLE(ed25519.utils.randomPrivateKey()) % L;
  const v = bytesToNumberLE(ed25519.utils.randomPrivateKey()) % L;
  const spendPub = Base.multiply(s).toRawBytes();
  const viewPub = Base.multiply(v).toRawBytes();
  return { spendScalar: s, viewScalar: v, meta: { spendPub, viewPub } };
}

/**
 * Derive a recipient's stealth keys deterministically from a `seed` — typically
 * the recipient's signature over a fixed message from their main wallet.
 *
 * Because the same seed always yields the same keys, the recipient recovers
 * their entire stealth identity from their wallet alone: nothing is stored, and
 * losing local state loses nothing. Spend and view scalars are domain-separated
 * so the view key (shareable with a scanning service) never leaks the spend key.
 */
export function deriveStealthKeys(seed: Uint8Array): StealthKeys {
  const enc = new TextEncoder();
  const s = hashToScalar(enc.encode("soteria:stealth:spend:v1"), seed);
  const v = hashToScalar(enc.encode("soteria:stealth:view:v1"), seed);
  const spendPub = Base.multiply(s).toRawBytes();
  const viewPub = Base.multiply(v).toRawBytes();
  return { spendScalar: s, viewScalar: v, meta: { spendPub, viewPub } };
}

/**
 * SENDER: derive a one-time stealth address for a recipient's meta-address.
 * Publish `ephemeralPub` (R) and `viewTag` so the recipient can detect it.
 */
export function deriveStealthAddress(meta: MetaAddress): StealthOutput {
  const r = bytesToNumberLE(ed25519.utils.randomPrivateKey()) % L;
  const R = Base.multiply(r).toRawBytes();

  const Vpoint = ed25519.ExtendedPoint.fromHex(meta.viewPub);
  const shared = Vpoint.multiply(r).toRawBytes(); // r*V = (r*v)*G
  const tweak = hashToScalar(shared); // common secret both sides can compute

  const Spoint = ed25519.ExtendedPoint.fromHex(meta.spendPub);
  const stealth = Spoint.add(Base.multiply(tweak)); // P = S + tweak*G
  const stealthPub = stealth.toRawBytes();

  const viewTag = sha512(concat([new Uint8Array([0x01]), shared]))[0];

  return {
    stealthPub,
    stealthAddress: new PublicKey(stealthPub),
    ephemeralPub: R,
    viewTag,
  };
}

/**
 * RECIPIENT: given an announced ephemeral key R, recompute the stealth pubkey
 * and (if it's ours) the one-time signing scalar. Returns null if no match.
 */
export function recoverStealth(
  keys: StealthKeys,
  ephemeralPub: Uint8Array,
  expectedViewTag?: number
): { stealthPub: Uint8Array; stealthScalar: bigint } | null {
  const Rpoint = ed25519.ExtendedPoint.fromHex(ephemeralPub);
  const shared = Rpoint.multiply(keys.viewScalar).toRawBytes(); // v*R = (r*v)*G

  if (expectedViewTag !== undefined) {
    const tag = sha512(concat([new Uint8Array([0x01]), shared]))[0];
    if (tag !== expectedViewTag) return null; // fast reject
  }

  const tweak = hashToScalar(shared);
  const stealthScalar = (keys.spendScalar + tweak) % L; // p = s + tweak
  const stealthPub = Base.multiply(stealthScalar).toRawBytes(); // must equal P

  return { stealthPub, stealthScalar };
}

/**
 * Sign a message with a recovered stealth scalar (raw-scalar ed25519).
 * Use this in a custom Solana transaction signer to spend from a stealth address.
 */
export function signWithStealthScalar(
  message: Uint8Array,
  stealthScalar: bigint
): Uint8Array {
  // Deterministic nonce from a domain-separated hash of (scalar || message).
  const sBytes = numberToBytesLE(stealthScalar, 32);
  const nonce = bytesToNumberLE(sha512(concat([sBytes, message]))) % L;
  const Rpt = Base.multiply(nonce);
  const Rbytes = Rpt.toRawBytes();
  const Abytes = Base.multiply(stealthScalar).toRawBytes();
  const k = bytesToNumberLE(sha512(concat([Rbytes, Abytes, message]))) % L;
  const S = (nonce + k * stealthScalar) % L;
  return concat([Rbytes, numberToBytesLE(S, 32)]);
}
