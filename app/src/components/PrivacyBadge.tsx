import { useState } from "react";
import { SERVER, setRelayerEndpoint, connectionPrivacy, type PrivacyLevel } from "../lib/soteria";

// Honest network-privacy indicator. The cryptography already hides who paid whom;
// the remaining leak is network metadata (your IP/timing) visible to the relayer.
// Only when BOTH the app and the relayer are onion services is that closed.
const META: Record<PrivacyLevel, { dot: string; label: string; cls: string }> = {
  tor: { dot: "🧅", label: "Tor", cls: "ok" },
  partial: { dot: "△", label: "Partial", cls: "warn" },
  clearnet: { dot: "⚠", label: "Clearnet", cls: "warn" },
};

export function PrivacyBadge() {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState(SERVER);
  const { level, onionApp, onionRelayer } = connectionPrivacy();
  const m = META[level];

  let explanation: string;
  if (level === "tor") {
    explanation =
      "The app and the relayer are both onion services — the relayer never sees your IP or timing. This is the fully anonymous path.";
  } else if (onionRelayer && !onionApp) {
    explanation =
      "The relayer is an onion address, but this page is on the clearnet — your browser can't reach it (mixed content / no Tor resolver). Open the app's .onion mirror in Tor Browser.";
  } else if (onionApp && !onionRelayer) {
    explanation =
      "The app is served over Tor, but the relayer is still a clearnet address — point it at the relayer's .onion below to close the loop.";
  } else {
    explanation =
      "You're on the public web. The relayer can see your IP and correlate timing. The on-chain link between your deposit and withdrawal stays hidden, but for full anonymity open the .onion mirror in Tor Browser.";
  }

  return (
    <div className="privacy-badge">
      <button
        className={`tag pill priv ${m.cls}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Network-privacy status"
      >
        <span aria-hidden="true">{m.dot}</span> {m.label}
      </button>

      {open && (
        <div className="priv-pop" role="dialog" aria-label="Network privacy">
          <p className="priv-text">{explanation}</p>

          <label className="field-label" htmlFor="priv-endpoint">Relayer endpoint</label>
          <input
            id="priv-endpoint"
            className="input"
            value={endpoint}
            placeholder="http://…onion or https://…"
            onChange={(e) => setEndpoint(e.target.value)}
            spellCheck={false}
          />
          <div className="priv-actions">
            <button
              className="act small"
              onClick={() => setRelayerEndpoint(endpoint)}
              disabled={endpoint.trim() === SERVER}
            >
              Save & reload
            </button>
            <button className="link-btn" onClick={() => setEndpoint(SERVER)}>reset</button>
          </div>
          <p className="priv-hint">
            To run over Tor: serve the app's onion mirror (<code>scripts/onion-app.sh</code>) and the
            relayer onion (<code>scripts/onion.sh</code>), open the app's <code>.onion</code> in Tor
            Browser, then set the relayer to its <code>.onion</code> here. See <code>docs/TOR.md</code>.
          </p>
        </div>
      )}
    </div>
  );
}
