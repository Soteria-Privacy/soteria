import { stealth, zk } from "@soteria1/sdk";

// Relayer endpoint. A privacy-conscious user (running the app over Tor) can
// point this at the relayer's .onion address at runtime — persisted locally and
// resolved at load, so all the `${SERVER}/...` fetches route over Tor without a
// rebuild. Falls back to the build-time env, then localhost.
const RELAYER_KEY = "soteria.relayer.v1";
function resolveRelayer(): string {
  if (typeof localStorage !== "undefined") {
    const override = localStorage.getItem(RELAYER_KEY);
    if (override) return override;
  }
  return import.meta.env.VITE_SOTERIA_SERVER ?? "http://localhost:8787";
}
export const SERVER = resolveRelayer();

/** Override the relayer endpoint (e.g. a .onion) and reload so it takes effect. */
export function setRelayerEndpoint(url: string): void {
  const v = url.trim().replace(/\/+$/, "");
  if (v) localStorage.setItem(RELAYER_KEY, v);
  else localStorage.removeItem(RELAYER_KEY);
  if (typeof location !== "undefined") location.reload();
}

export type PrivacyLevel = "tor" | "partial" | "clearnet";
const isOnion = (s: string) => /\.onion(?::\d+)?(?:\/|$)/.test(s);
/** Honest read of the current network-privacy posture: is the app itself served
 *  over Tor, and is the relayer an onion? Only "both" hides your IP end-to-end. */
export function connectionPrivacy(): {
  level: PrivacyLevel; onionApp: boolean; onionRelayer: boolean;
} {
  const host = typeof location !== "undefined" ? location.hostname : "";
  const onionApp = host.endsWith(".onion");
  const onionRelayer = isOnion(SERVER);
  const level: PrivacyLevel =
    onionApp && onionRelayer ? "tor" : onionApp || onionRelayer ? "partial" : "clearnet";
  return { level, onionApp, onionRelayer };
}
export const RPC_URL =
  import.meta.env.VITE_SOLANA_RPC ?? "https://api.devnet.solana.com";
export const PROGRAM_ID =
  import.meta.env.VITE_SOTERIA_PROGRAM_ID ??
  "9HNLpUVFX61pX759oy1vuMMwQaQaGnK9KgMyhTrDrRGs";
// On-chain group + circuit scope this demo proves membership against.
export const GROUP_ID = Number(import.meta.env.VITE_SOTERIA_GROUP_ID ?? 0);
export const EXTERNAL_NULLIFIER = BigInt(
  import.meta.env.VITE_SOTERIA_EXTERNAL_NULLIFIER ?? "1"
);

export interface RawProof {
  proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
  publicSignals: string[];
}

// Submit a proof through the backend relayer (the relayer pays + signs, so the
// prover's wallet never appears on-chain). Returns the tx signature.
export async function relayVerify(
  groupId: number,
  raw: RawProof
): Promise<{ ok: boolean; signature?: string; error?: string; code?: string }> {
  const res = await fetch(`${SERVER}/relay/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId, proof: raw.proof, publicSignals: raw.publicSignals }),
  });
  return res.json();
}

export function toB64(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function short(hex: string, n = 6): string {
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}

export { stealth, zk };
