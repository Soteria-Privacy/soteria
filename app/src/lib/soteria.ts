import { stealth, zk } from "@soteria/sdk";

export const SERVER = import.meta.env.VITE_SOTERIA_SERVER ?? "http://localhost:8787";
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
