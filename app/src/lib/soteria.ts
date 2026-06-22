import { stealth, zk } from "@soteria/sdk";

export const SERVER = import.meta.env.VITE_SOTERIA_SERVER ?? "http://localhost:8787";

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
