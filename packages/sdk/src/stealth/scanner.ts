import { recoverStealth, StealthKeys } from "./stealth.js";

/** One published announcement: the sender's ephemeral key + a view tag. */
export interface Announcement {
  ephemeralPub: Uint8Array; // R
  viewTag: number;
  // Optional metadata your registry may attach:
  stealthPub?: Uint8Array; // the address funds were sent to (for matching)
  slot?: number;
  signature?: string;
}

export interface DetectedPayment {
  stealthPub: Uint8Array;
  stealthScalar: bigint; // signing scalar — keep secret
  announcement: Announcement;
}

/**
 * Scan a batch of announcements for payments addressed to `keys`.
 * The view tag lets us reject ~255/256 of non-matching announcements with a
 * single hash before doing the full point recovery.
 */
export function scanAnnouncements(
  keys: StealthKeys,
  announcements: Announcement[]
): DetectedPayment[] {
  const found: DetectedPayment[] = [];
  for (const ann of announcements) {
    const res = recoverStealth(keys, ann.ephemeralPub, ann.viewTag);
    if (!res) continue;
    // If the registry recorded the destination, confirm it matches ours.
    if (ann.stealthPub && !equal(ann.stealthPub, res.stealthPub)) continue;
    found.push({
      stealthPub: res.stealthPub,
      stealthScalar: res.stealthScalar,
      announcement: ann,
    });
  }
  return found;
}

function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
