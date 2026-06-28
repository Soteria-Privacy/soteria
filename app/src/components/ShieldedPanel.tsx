import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  deriveIdentity,
  myAddress,
  myNotes,
  balance,
  deposit,
  pay,
  withdraw,
  type Identity,
} from "../lib/shielded";
import { short } from "../lib/soteria";

const toLamports = (sol: string) => BigInt(Math.round(parseFloat(sol) * LAMPORTS_PER_SOL));
const FEE = 5000n;

type Tab = "deposit" | "pay" | "withdraw";
const LABELS: Record<Tab, { primary: string; busy: string }> = {
  deposit: { primary: "Deposit privately", busy: "Depositing…" },
  pay: { primary: "Pay privately", busy: "Proving & paying…" },
  withdraw: { primary: "Withdraw", busy: "Proving & withdrawing…" },
};

export function ShieldedPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const [tab, setTab] = useState<Tab>("deposit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [id, setId] = useState<Identity | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);
  const [copied, setCopied] = useState(false);

  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");

  async function unlock() {
    if (!signMessage) { setError("This wallet can't sign messages."); return null; }
    setError(null);
    try {
      const ident = await deriveIdentity(signMessage);
      setId(ident);
      await refresh(ident);
      return ident;
    } catch (e) { setError((e as Error).message); return null; }
  }

  async function refresh(ident: Identity) {
    try { setBal(balance(await myNotes(ident))); } catch { setBal(0n); }
  }

  async function run(fn: (ident: Identity) => Promise<string>) {
    const ident = id ?? (await unlock());
    if (!ident) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      setStatus(await fn(ident));
      await refresh(ident);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function onSubmit() {
    if (!publicKey) return;
    const amt = toLamports(amount);
    run(async (ident) => {
      if (tab === "deposit") {
        const r = await deposit({ connection, wallet: publicKey, sendTransaction, id: ident, amount: amt });
        return `Deposited — tx ${short(r.signature, 8)}`;
      }
      if (tab === "pay") {
        const r = await pay({ id: ident, toAddress: toAddress.trim(), amount: amt, fee: FEE });
        return `Paid privately — tx ${short(r.signature, 8)}`;
      }
      const r = await withdraw({ id: ident, toSolAddress: toAddress.trim(), amount: amt, fee: FEE });
      return `Withdrawn — tx ${short(r.signature, 8)}`;
    });
  }

  async function copyAddr() {
    if (!id) return;
    try {
      await navigator.clipboard.writeText(myAddress(id));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  const sol = (b: bigint | null) => (b === null ? "…" : (Number(b) / LAMPORTS_PER_SOL).toFixed(4));
  const needsAddr = tab !== "deposit";
  const canSubmit = Boolean(amount) && (!needsAddr || Boolean(toAddress));

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Private payments</h3>
        <span className="status">devnet</span>
      </div>
      <p className="sub">
        Deposit <strong>any amount</strong> into one private balance. Pay anyone privately —
        amounts are <strong>encrypted</strong>, change comes back automatically, and the chain
        never sees who paid whom or how much.
      </p>

      {!publicKey ? (
        <div className="connect-cta"><WalletMultiButton /></div>
      ) : !id ? (
        <div className="connect-cta">
          <button className="act block" onClick={unlock}>Unlock my shielded balance</button>
          <p className="sub small">Sign once to derive your shielded keys — nothing leaves your device.</p>
        </div>
      ) : (
        <>
          <div className="balance-hero">
            <div>
              <div className="balance-label">Shielded balance</div>
              <div className="balance-amount">{sol(bal)}<span>SOL</span></div>
            </div>
            <button
              className={`addr-chip ${copied ? "copied" : ""}`}
              onClick={copyAddr}
              aria-label="Copy your shielded payment address"
            >
              <span className="addr-chip-k">your address</span>
              <span className="addr-chip-v">{short(myAddress(id), 6)}</span>
              <span className="addr-chip-cta">{copied ? "✓ copied" : "copy"}</span>
            </button>
          </div>
          <p className="sub small">Share your address so people can pay you privately.</p>

          <div className="seg" role="tablist" aria-label="Action">
            {(["deposit", "pay", "withdraw"] as Tab[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? "on" : ""}
                onClick={() => { setTab(t); setStatus(null); setError(null); }}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="pay-form">
            <label className="field-label" htmlFor="sh-amount">Amount</label>
            <div className="input-suffix">
              <input
                id="sh-amount"
                className="input"
                inputMode="decimal"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
              />
              <span className="suffix">SOL</span>
            </div>

            {needsAddr && (
              <>
                <label className="field-label" htmlFor="sh-to">
                  {tab === "pay" ? "Recipient's shielded address" : "Withdraw to"}
                </label>
                <input
                  id="sh-to"
                  className="input"
                  value={toAddress}
                  placeholder={tab === "pay" ? "a Soteria shielded address" : "any Solana wallet address"}
                  onChange={(e) => setToAddress(e.target.value)}
                />
              </>
            )}

            <button className="act block" disabled={busy || !canSubmit} onClick={onSubmit}>
              {busy ? <><span className="spinner" aria-hidden="true" />{LABELS[tab].busy}</> : LABELS[tab].primary}
            </button>
            {needsAddr && (
              <p className="sub small">
                Network fee {(Number(FEE) / LAMPORTS_PER_SOL).toFixed(6)} SOL — paid to the relayer.
              </p>
            )}
          </div>
        </>
      )}

      {status && <div className="toast ok" role="status">✓ {status}</div>}
      {error && <div className="toast err" role="alert">⚠ {error}</div>}
    </div>
  );
}
