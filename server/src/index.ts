import express from "express";
import cors from "cors";
import { store } from "./store.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT ?? 8787);

app.get("/health", (_req, res) => res.json({ ok: true, service: "soteria" }));

// ── Stealth announcement registry ────────────────────────────────────────────
// Senders publish the ephemeral key (R) + view tag here; recipients scan it.
// This stores only public, unlinkable data — no funds move through this service.
app.post("/announce", (req, res) => {
  const { ephemeralPub, viewTag, stealthPub, slot, signature } = req.body ?? {};
  if (typeof ephemeralPub !== "string" || typeof viewTag !== "number") {
    return res
      .status(400)
      .json({ error: "ephemeralPub (base64) and viewTag (number) are required" });
  }
  store.addAnnouncement({ ephemeralPub, viewTag, stealthPub, slot, signature });
  res.json({ ok: true });
});

app.get("/announcements", (req, res) => {
  const since = req.query.sinceSlot ? Number(req.query.sinceSlot) : undefined;
  res.json({ announcements: store.getAnnouncements(since) });
});

// ── Credential member sets (for the ZK selective-disclosure circuit) ─────────
// A "set" is an allowlist / electorate. Adding a member appends a Poseidon
// identity commitment; publishing the root makes proofs verifiable on-chain.
app.post("/sets/:id/members", (req, res) => {
  const { commitment } = req.body ?? {};
  if (typeof commitment !== "string") {
    return res.status(400).json({ error: "commitment (decimal string) required" });
  }
  const index = store.addMember(req.params.id, commitment);
  res.json({ ok: true, index });
});

app.get("/sets/:id", (req, res) => {
  const s = store.getOrCreateSet(req.params.id);
  res.json({ commitments: s.commitments, root: s.root });
});

// The client rebuilds the Poseidon tree and posts the computed root back, or a
// trusted indexer recomputes it. Kept explicit so root publication is auditable.
app.post("/sets/:id/root", (req, res) => {
  const { root } = req.body ?? {};
  if (typeof root !== "string") {
    return res.status(400).json({ error: "root (decimal string) required" });
  }
  store.setRoot(req.params.id, root);
  res.json({ ok: true, root });
});

// ── Proof relay ──────────────────────────────────────────────────────────────
// Optional convenience: clients can submit a formatted proof and the relayer
// forwards the verify instruction (paying fees) so the prover's wallet never
// has to appear. This relays a single verify tx; it does not custody funds.
app.post("/relay/verify", async (req, res) => {
  const { nullifierHash } = req.body ?? {};
  if (typeof nullifierHash !== "string") {
    return res.status(400).json({ error: "nullifierHash (string) required" });
  }
  if (store.isSpent(nullifierHash)) {
    return res.status(409).json({ error: "nullifier already spent" });
  }
  // TODO: build + send the soteria_verifier `verify` instruction with the
  // proof bytes from req.body using @coral-xyz/anchor and a relayer keypair.
  // On confirmation:
  store.markSpent(nullifierHash);
  res.json({ ok: true, note: "wire to soteria_verifier program to send on-chain" });
});

app.listen(PORT, () => {
  console.log(`soteria server listening on http://localhost:${PORT}`);
});
