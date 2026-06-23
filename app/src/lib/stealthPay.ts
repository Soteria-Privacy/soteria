import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { stealth, SERVER, toB64, fromB64 } from "./soteria";

export type MetaAddress = ReturnType<typeof stealth.generateStealthKeys>["meta"];
export type StealthKeys = ReturnType<typeof stealth.generateStealthKeys>;

// The receiver signs this fixed message once; its signature deterministically
// seeds their stealth keys, so the whole receiving identity is recoverable from
// the wallet alone — nothing is stored server-side or in local storage.
export const DERIVE_MESSAGE = new TextEncoder().encode(
  "Soteria private payments\n\nSign to generate your private receiving keys. " +
    "This signature never leaves your device. Only sign on soteria."
);

// ── meta-address <-> shareable string (base64url of spendPub||viewPub) ──
export function encodeMeta(meta: MetaAddress): string {
  const buf = new Uint8Array(64);
  buf.set(meta.spendPub, 0);
  buf.set(meta.viewPub, 32);
  return toB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Accept either a bare code or a full pay link (e.g. ".../?pay=<code>#pay").
export function extractPayCode(input: string): string {
  const s = input.trim();
  const m = s.match(/[?&]pay=([^&#\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

export function decodeMeta(input: string): MetaAddress {
  const code = extractPayCode(input);
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = fromB64(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  if (bytes.length < 64) throw new Error("invalid payment link");
  return { spendPub: bytes.slice(0, 32), viewPub: bytes.slice(32, 64) };
}

export function payLink(meta: MetaAddress): string {
  const base = typeof location !== "undefined" ? location.origin + location.pathname : "";
  return `${base}?pay=${encodeMeta(meta)}#pay`;
}

// ── SENDER: pay a meta-address, then announce so the receiver can find it ──
export async function sendPrivate(opts: {
  connection: Connection;
  sender: PublicKey;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
  meta: MetaAddress;
  sol: number;
}): Promise<{ signature: string; stealthAddress: string }> {
  const { connection, sender, sendTransaction, meta, sol } = opts;
  const out = stealth.deriveStealthAddress(meta);
  const lamports = Math.round(sol * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: out.stealthAddress,
      lamports,
    })
  );
  tx.feePayer = sender;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signature = await sendTransaction(tx, connection);
  await connection.confirmTransaction(signature, "confirmed");

  // Publish the ephemeral key + view tag so the recipient can detect this.
  await fetch(`${SERVER}/announce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ephemeralPub: toB64(out.ephemeralPub),
      viewTag: out.viewTag,
      stealthPub: toB64(out.stealthPub),
    }),
  });

  return { signature, stealthAddress: out.stealthAddress.toBase58() };
}

export interface DetectedPayment {
  stealthPub: Uint8Array;
  stealthScalar: bigint;
  address: string;
  lamports: number;
}

// ── RECEIVER: scan the registry for payments to us, with their balances ──
export async function scanPayments(opts: {
  connection: Connection;
  keys: StealthKeys;
  limit?: number;
}): Promise<DetectedPayment[]> {
  const { connection, keys, limit = 200 } = opts;
  const res = await fetch(`${SERVER}/announcements?limit=${limit}`);
  const { announcements } = (await res.json()) as {
    announcements: Array<{ ephemeralPub: string; viewTag: number; stealthPub?: string }>;
  };
  const decoded = announcements.map((a) => ({
    ephemeralPub: fromB64(a.ephemeralPub),
    viewTag: a.viewTag,
    stealthPub: a.stealthPub ? fromB64(a.stealthPub) : undefined,
  }));
  const found = stealth.scanAnnouncements(keys, decoded);

  const payments: DetectedPayment[] = [];
  for (const f of found) {
    const address = new PublicKey(f.stealthPub).toBase58();
    const lamports = await connection.getBalance(new PublicKey(f.stealthPub), "confirmed");
    if (lamports > 0) {
      payments.push({ stealthPub: f.stealthPub, stealthScalar: f.stealthScalar, address, lamports });
    }
  }
  return payments;
}

// ── RECEIVER: sweep a detected payment to the main wallet (raw-scalar signed) ──
export async function sweep(opts: {
  connection: Connection;
  payment: DetectedPayment;
  destination: PublicKey;
}): Promise<string> {
  const { connection, payment, destination } = opts;
  const FEE = 5000;
  const amount = payment.lamports - FEE;
  if (amount <= 0) throw new Error("balance too low to cover the network fee");

  const stealthAddress = new PublicKey(payment.stealthPub);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: stealthAddress, toPubkey: destination, lamports: amount })
  );
  tx.feePayer = stealthAddress;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  // A stealth one-time key is a raw scalar, so we sign the message bytes
  // directly (Monero-style) and attach the signature — a normal Keypair can't
  // hold this key.
  const message = tx.serializeMessage();
  const sig = stealth.signWithStealthScalar(message, payment.stealthScalar);
  tx.addSignature(stealthAddress, Buffer.from(sig));

  const signature = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

export const fmtSol = (lamports: number) => (lamports / LAMPORTS_PER_SOL).toFixed(4);
