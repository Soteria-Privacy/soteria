/// <reference lib="webworker" />
import { Connection, PublicKey } from "@solana/web3.js";
import { scanPayments, sweep, type DetectedPayment, type StealthKeys } from "./stealthPay";

// Background worker: polls the registry and (optionally) sweeps payments to the
// owner's wallet the moment they land — independent of the UI thread. Keys are
// passed in once and never leave the device; the sweep is signed with the
// one-time key, so no wallet prompt is needed.

type StartMsg = {
  type: "start";
  rpcUrl: string;
  keys: StealthKeys;
  destination: string;
  autoSweep: boolean;
};
type InMsg =
  | StartMsg
  | { type: "setAutoSweep"; value: boolean }
  | { type: "sweepOne"; address: string }
  | { type: "stop" };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const seen = new Set<string>();
const inFlight = new Set<string>();
const cache = new Map<string, DetectedPayment>();
let connection: Connection | null = null;
let destination: PublicKey | null = null;
let keys: StealthKeys | null = null;
let autoSweep = true;
let timer: ReturnType<typeof setInterval> | null = null;

async function sweepOne(p: DetectedPayment) {
  if (!connection || !destination || inFlight.has(p.address)) return;
  inFlight.add(p.address);
  ctx.postMessage({ type: "status", address: p.address, status: "sweeping" });
  try {
    const sig = await sweep({ connection, payment: p, destination });
    ctx.postMessage({ type: "status", address: p.address, status: "swept", sig });
  } catch (e) {
    ctx.postMessage({
      type: "status",
      address: p.address,
      status: "failed",
      error: e instanceof Error ? e.message : "sweep failed",
    });
  } finally {
    inFlight.delete(p.address);
  }
}

async function tick() {
  if (!connection || !keys) return;
  let found: DetectedPayment[];
  try {
    found = await scanPayments({ connection, keys });
  } catch {
    return; // transient RPC/registry blip — next tick retries
  }
  for (const p of found) {
    cache.set(p.address, p);
    if (seen.has(p.address)) continue;
    seen.add(p.address);
    ctx.postMessage({ type: "detected", address: p.address, lamports: p.lamports });
    if (autoSweep) sweepOne(p);
  }
}

// addEventListener (not `onmessage =`) so messages posted before this module
// finishes evaluating are still delivered — a common module-worker pitfall.
ctx.addEventListener("message", (e: MessageEvent<InMsg>) => {
  const m = e.data;
  if (m.type === "start") {
    connection = new Connection(m.rpcUrl, "confirmed");
    destination = new PublicKey(m.destination);
    keys = m.keys;
    autoSweep = m.autoSweep;
    if (timer) clearInterval(timer);
    tick();
    timer = setInterval(tick, 8000);
  } else if (m.type === "setAutoSweep") {
    autoSweep = m.value;
    if (autoSweep) for (const p of cache.values()) if (!inFlight.has(p.address)) sweepOne(p);
  } else if (m.type === "sweepOne") {
    const p = cache.get(m.address);
    if (p) sweepOne(p);
  } else if (m.type === "stop") {
    if (timer) clearInterval(timer);
    timer = null;
  }
});

// Tell the main thread we're ready to receive `start` (avoids a startup race).
ctx.postMessage({ type: "ready" });
