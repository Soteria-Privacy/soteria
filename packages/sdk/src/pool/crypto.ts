import { x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

// Encrypt a pool note to a recipient so a claim link can travel over a public
// channel: only the holder of the matching private key can decrypt it. ECIES =
// ephemeral X25519 ECDH -> HKDF-SHA256 -> AES-256-GCM. No extra deps (WebCrypto
// is present in the browser and in Node 20+).

const ENC_PREFIX = "soteria-enc-v1";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A concrete ArrayBuffer copy, so the WebCrypto BufferSource types don't trip on
// the ArrayBufferLike/SharedArrayBuffer generic.
function buf(u: Uint8Array): ArrayBuffer {
  return u.slice().buffer;
}

/**
 * Derive a recipient's X25519 receiving keypair from a 32+ byte seed — e.g. the
 * bytes of a wallet signature over a fixed message, so the identity is
 * recoverable from the wallet alone and nothing is ever stored.
 */
export function receiveKeypairFromSeed(seed: Uint8Array): {
  priv: Uint8Array;
  pub: Uint8Array;
} {
  const priv = sha256(seed); // 32 bytes; X25519 clamps internally
  return { priv, pub: x25519.getPublicKey(priv) };
}

/** Shareable encoding of a receiving public key (a "private-payment address"). */
export function encodeReceiveAddress(pub: Uint8Array): string {
  return b64url(pub);
}

export function decodeReceiveAddress(s: string): Uint8Array {
  const pub = unb64url(s.trim());
  if (pub.length !== 32) throw new Error("invalid private-payment address");
  return pub;
}

async function aesKey(shared: Uint8Array): Promise<CryptoKey> {
  const raw = hkdf(sha256, shared, undefined, "soteria-pool-note", 32);
  return crypto.subtle.importKey("raw", buf(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt a note string to a recipient's receiving public key. */
export async function encryptNote(
  noteStr: string,
  recipientPub: Uint8Array
): Promise<string> {
  const eph = x25519.utils.randomPrivateKey();
  const ephPub = x25519.getPublicKey(eph);
  const shared = x25519.getSharedSecret(eph, recipientPub);
  const key = await aesKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      buf(new TextEncoder().encode(noteStr))
    )
  );
  const blob = new Uint8Array(32 + 12 + ct.length);
  blob.set(ephPub, 0);
  blob.set(iv, 32);
  blob.set(ct, 44);
  return `${ENC_PREFIX}:${b64url(blob)}`;
}

export function isEncryptedNote(s: string): boolean {
  return s.trim().startsWith(ENC_PREFIX + ":");
}

/** Decrypt an encrypted note with the recipient's receiving private key. */
export async function decryptNote(
  blobStr: string,
  recipientPriv: Uint8Array
): Promise<string> {
  const blob = unb64url(blobStr.trim().slice(ENC_PREFIX.length + 1));
  const ephPub = blob.slice(0, 32);
  const iv = blob.slice(32, 44);
  const ct = blob.slice(44);
  const shared = x25519.getSharedSecret(recipientPriv, ephPub);
  const key = await aesKey(shared);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(iv) }, key, buf(ct));
  return new TextDecoder().decode(pt);
}
