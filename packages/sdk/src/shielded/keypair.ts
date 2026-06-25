import { buildPoseidon } from "circomlibjs";
import { x25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";

// BN254 scalar field.
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let _poseidon: any;
export async function poseidon(): Promise<any> {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}
export async function H(xs: bigint[]): Promise<bigint> {
  const p = await poseidon();
  return BigInt(p.F.toString(p(xs)));
}

/**
 * A shielded identity. `privateKey`/`publicKey` are the in-circuit spending key
 * (used to derive note nullifiers); `encPriv`/`encPub` are an X25519 pair used
 * to encrypt note secrets to the owner. Both are derived from one wallet
 * signature, so the whole identity is recoverable and nothing is stored.
 */
export interface ShieldedKeypair {
  privateKey: bigint;
  publicKey: bigint;
  encPriv: Uint8Array;
  encPub: Uint8Array;
}

const enc = new TextEncoder();
function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
function bytesToField(b: Uint8Array): bigint {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % FIELD;
}
function toBytes32(v: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a shielded identity from a 32+ byte seed (e.g. a wallet signature). */
export async function deriveShieldedKeypair(seed: Uint8Array): Promise<ShieldedKeypair> {
  const privateKey = bytesToField(sha256(concat(seed, enc.encode("soteria-shielded-spend"))));
  const encPriv = sha256(concat(seed, enc.encode("soteria-shielded-enc")));
  return {
    privateKey,
    publicKey: await H([privateKey]),
    encPriv,
    encPub: x25519.getPublicKey(encPriv),
  };
}

/** Shareable shielded address = base64url(publicKey || encPub). */
export function encodeShieldedAddress(kp: ShieldedKeypair): string {
  return b64url(concat(toBytes32(kp.publicKey), kp.encPub));
}

export function decodeShieldedAddress(s: string): { publicKey: bigint; encPub: Uint8Array } {
  const bytes = unb64url(s.trim());
  if (bytes.length !== 64) throw new Error("invalid shielded address");
  return { publicKey: bytesToField(bytes.slice(0, 32)), encPub: bytes.slice(32, 64) };
}
