import { useState } from "react";
import { SERVER, short, CLUSTER_LABEL, explorerAddress } from "../lib/soteria";

interface DemoResult {
  ok: boolean;
  mint: string;
  recipient: string;
  recipientTokenAccount: string;
  decimals: number;
  amount: string;
  onChainPublicAmount: string;
  recipientDecrypted: string;
  auditorElGamalPubkey: string;
  error?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; result: DemoResult }
  | { kind: "error"; message: string };

const fmt = (base: string, decimals: number) =>
  (Number(base) / 10 ** decimals).toFixed(decimals);

export function ConfidentialPanel() {
  const [tokens, setTokens] = useState("2.50");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function runDemo() {
    const amount = Math.round(parseFloat(tokens) * 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      setStatus({ kind: "error", message: "enter a positive amount" });
      return;
    }
    setStatus({ kind: "busy" });
    try {
      const res = await fetch(`${SERVER}/confidential/demo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = (await res.json()) as DemoResult;
      if (res.ok && data.ok) setStatus({ kind: "ok", result: data });
      else setStatus({ kind: "error", message: data.error ?? "demo failed" });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : "request failed",
      });
    }
  }

  return (
    <div className="panel">
      <h3>Confidential amounts</h3>
      <p className="sub">
        Hide transfer amounts and balances with Token-2022 confidential transfers,
        while keeping a mint-level auditor key for compliance. The transaction graph
        stays public — only the numbers are shielded.
      </p>
      <span className="status">{CLUSTER_LABEL} · live</span>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="field">
          <label>transfer amount (tokens)</label>
          <input
            value={tokens}
            onChange={(e) => setTokens(e.target.value)}
            inputMode="decimal"
          />
        </div>
      </div>
      <div className="row">
        <button className="act" onClick={runDemo} disabled={status.kind === "busy"}>
          {status.kind === "busy"
            ? `Running on ${CLUSTER_LABEL}… (~30s)`
            : "Run confidential transfer"}
        </button>
      </div>

      <div className="readout" style={{ marginTop: 14 }}>
        <div>
          <span className="k">flow </span>mint
          <span className="k"> → </span>deposit
          <span className="k"> → </span>apply
          <span className="k"> → </span>
          <span className="shielded">confidential transfer</span>
          <span className="k"> → </span>withdraw
        </div>
        <div style={{ marginTop: 8 }}>
          <span className="k">auditor </span>
          <span className="ok">ElGamal key set at mint level</span>
        </div>
      </div>

      {status.kind === "ok" && (
        <div className="readout ok" style={{ marginTop: 10 }}>
          <div>
            <span className="k">on-chain amount </span>
            <span className="shielded">
              {fmt(status.result.onChainPublicAmount, status.result.decimals)} · hidden
            </span>
          </div>
          <div>
            <span className="k">recipient decrypts </span>
            <span className="ok">
              {fmt(status.result.recipientDecrypted, status.result.decimals)} tokens
            </span>
          </div>
          <div>
            <span className="k">mint </span>
            <a
              href={explorerAddress(status.result.mint)}
              target="_blank"
              rel="noreferrer"
            >
              {short(status.result.mint)}
            </a>
          </div>
          <div>
            <span className="k">recipient </span>
            {short(status.result.recipient)}
          </div>
        </div>
      )}
      {status.kind === "error" && (
        <div className="readout" style={{ marginTop: 10 }}>
          <span className="k">error </span>
          {status.message}
        </div>
      )}

      <p className="hint">
        The operator relays a full Token-2022 confidential transfer on {CLUSTER_LABEL}: the
        amount is encrypted on-chain (twisted ElGamal) and verified with ZK proofs,
        yet the recipient decrypts the exact value. Account keys are derived from the
        owner's signature, so they're recoverable and never stored.
      </p>
    </div>
  );
}
