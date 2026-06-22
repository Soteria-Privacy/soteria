import { useState } from "react";
import { stealth, toB64, short, SERVER } from "../lib/soteria";

export function StealthPanel() {
  const [keys, setKeys] = useState<ReturnType<typeof stealth.generateStealthKeys> | null>(null);
  const [sent, setSent] = useState<{ address: string; ephemeral: string } | null>(null);
  const [detected, setDetected] = useState<string | null>(null);

  function makeMeta() {
    setKeys(stealth.generateStealthKeys());
    setSent(null);
    setDetected(null);
  }

  function sendToMeta() {
    if (!keys) return;
    const out = stealth.deriveStealthAddress(keys.meta);
    setSent({ address: out.stealthAddress.toBase58(), ephemeral: toB64(out.ephemeralPub) });
    // publish the announcement so the recipient can scan it
    fetch(`${SERVER}/announce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ephemeralPub: toB64(out.ephemeralPub), viewTag: out.viewTag, stealthPub: toB64(out.stealthPub) }),
    }).catch(() => {});
  }

  async function scan() {
    if (!keys) return;
    const r = await fetch(`${SERVER}/announcements`).then((x) => x.json()).catch(() => ({ announcements: [] }));
    const anns = (r.announcements ?? []).map((a: any) => ({
      ephemeralPub: Uint8Array.from(atob(a.ephemeralPub), (c) => c.charCodeAt(0)),
      viewTag: a.viewTag,
    }));
    const found = stealth.scanAnnouncements(keys, anns);
    setDetected(found.length ? `${found.length} payment(s) detected — first at ${short(toB64(found[0].stealthPub))}` : "no payments detected");
  }

  return (
    <div className="panel">
      <h3>Stealth receiving</h3>
      <p className="sub">
        Generate a meta-address you can share publicly. Senders derive a fresh one-time
        address per payment, so your main wallet never appears as the recipient.
      </p>
      <span className="status">mainnet-ready</span>

      <div className="row" style={{ marginTop: 18 }}>
        <button className="act" onClick={makeMeta}>Generate meta-address</button>
        <button className="act ghost" onClick={sendToMeta} disabled={!keys}>Simulate a sender</button>
        <button className="act ghost" onClick={scan} disabled={!keys}>Scan for payments</button>
      </div>

      {keys && (
        <div className="readout">
          <div><span className="k">spend pub </span>{short(toB64(keys.meta.spendPub), 10)}</div>
          <div><span className="k">view pub  </span>{short(toB64(keys.meta.viewPub), 10)}</div>
        </div>
      )}
      {sent && (
        <div className="readout" style={{ marginTop: 10 }}>
          <div><span className="k">one-time address </span><span className="shielded">{short(sent.address, 10)}</span></div>
          <div><span className="k">ephemeral key R  </span>{short(sent.ephemeral, 10)}</div>
        </div>
      )}
      {detected && <div className="readout ok" style={{ marginTop: 10 }}><span className="ok">{detected}</span></div>}

      <p className="hint">
        Spending from a stealth address uses raw-scalar ed25519 signing
        (signWithStealthScalar) — wire it into a custom transaction signer.
      </p>
    </div>
  );
}
