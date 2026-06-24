import type { StealthKeys } from "./stealthPay";

// Local persistence for the receiving identity and payment history. Everything
// stays on this device — the identity is recoverable from the wallet signature,
// so storing it is a convenience (auto-resume watching), not a custody change.

const IDENTITY_KEY = "soteria.identity.v1";
const ACTIVITY_KEY = "soteria.activity.v1";

const toHex = (b: bigint) => b.toString(16);
const fromHex = (s: string) => BigInt("0x" + s);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function saveIdentity(keys: StealthKeys): void {
  localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({
      s: toHex(keys.spendScalar),
      v: toHex(keys.viewScalar),
      sp: b64(keys.meta.spendPub),
      vp: b64(keys.meta.viewPub),
    })
  );
}

export function loadIdentity(): StealthKeys | null {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return {
      spendScalar: fromHex(o.s),
      viewScalar: fromHex(o.v),
      meta: { spendPub: unb64(o.sp), viewPub: unb64(o.vp) },
    };
  } catch {
    return null;
  }
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}

export type ActivityKind = "sent" | "received";
export type ActivityStatus = "sent" | "received" | "sweeping" | "swept" | "failed";

export interface Activity {
  id: string; // received: one-time address · sent: tx signature
  kind: ActivityKind;
  lamports: number;
  address: string; // the one-time stealth address
  status: ActivityStatus;
  sig?: string;
  ts: number;
}

export function getActivity(): Activity[] {
  try {
    return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "[]");
  } catch {
    return [];
  }
}

/** Insert or merge an entry (by id + kind), newest first, and notify listeners. */
export function putActivity(a: Partial<Activity> & { id: string; kind: ActivityKind }): void {
  const all = getActivity();
  const i = all.findIndex((x) => x.id === a.id && x.kind === a.kind);
  if (i >= 0) all[i] = { ...all[i], ...a };
  else all.unshift({ lamports: 0, address: "", status: "received", ts: Date.now(), ...a });
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 200)));
  window.dispatchEvent(new Event("soteria-activity"));
}

export function onActivityChange(fn: () => void): () => void {
  window.addEventListener("soteria-activity", fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener("soteria-activity", fn);
    window.removeEventListener("storage", fn);
  };
}
