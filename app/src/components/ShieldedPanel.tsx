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

export function ShieldedPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const [tab, setTab] = useState<Tab>("deposit");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [id, setId] = useState<Identity | null>(null);
  const [bal, setBal] = useState<bigint | null>(null);

  const [amount, setAmount] = useState("");
  const [toAddress, setToAddress] = useState("");

  async function unlock() {
    if (!signMessage) { setError("wallet can't sign messages"); return null; }
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
    let ident = id ?? (await unlock());
    if (!ident) return;
    setBusy(true); setError(null); setStatus(null);
    try {
      setStatus(await fn(ident));
      await refresh(ident);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const sol = (b: bigint | null) => (b === null ? "…" : (Number(b) / LAMPORTS_PER_SOL).toFixed(6));

  return (
    <div className="panel">
      <h3>Shielded payments (any amount)</h3>
      <p className="sub">
        Deposit <strong>any amount</strong> into one shielded balance. Pay anyone privately —
        amounts are <strong>encrypted</strong>, change comes back automatically, and the chain
        never sees who paid whom or how much.
      </p>
      <span className="status">devnet · hidden-amount pool</span>

      {!publicKey ? (
        <div style={{ marginTop: 18 }}><WalletMultiButton /></div>
      ) : !id ? (
        <div style={{ marginTop: 18 }}>
          <button className="act" onClick={unlock}>Unlock my shielded balance</button>
          <div className="sub" style={{ marginTop: 6 }}>Sign once to derive your shielded keys.</div>
        </div>
      ) : (
        <>
          <div className="readout" style={{ marginTop: 16 }}>
            <div><span className="k">shielded balance </span><strong style={{ color: "#34e7cf" }}>{sol(bal)} SOL</strong></div>
            <div style={{ marginTop: 8 }}><span className="k">your address </span>{short(myAddress(id), 10)}</div>
            <textarea className="input" readOnly rows={2} value={myAddress(id)}
              style={{ width: "100%", fontFamily: "monospace", marginTop: 6 }}
              onFocus={(e) => e.currentTarget.select()} />
            <div className="sub" style={{ marginTop: 4 }}>Share this address so people can pay you privately.</div>
          </div>

          <div className="row" style={{ marginTop: 16 }}>
            {(["deposit", "pay", "withdraw"] as Tab[]).map((t) => (
              <button key={t} className={`act ${tab === t ? "" : "ghost"}`} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <label className="k">Amount (SOL)</label>
            <input className="input" value={amount} placeholder="e.g. 0.37"
              style={{ width: "100%", marginBottom: 12 }} onChange={(e) => setAmount(e.target.value)} />

            {tab !== "deposit" && (
              <>
                <label className="k">{tab === "pay" ? "Recipient shielded address" : "Withdraw to (Solana address)"}</label>
                <input className="input" value={toAddress}
                  placeholder={tab === "pay" ? "their soteria shielded address" : "a Solana wallet"}
                  style={{ width: "100%", marginBottom: 12, fontFamily: "monospace" }}
                  onChange={(e) => setToAddress(e.target.value)} />
              </>
            )}

            {tab === "deposit" ? (
              <button className="act" disabled={busy || !amount} onClick={() =>
                run(async (ident) => {
                  const r = await deposit({ connection, wallet: publicKey, sendTransaction, id: ident, amount: toLamports(amount) });
                  return `deposited — tx ${short(r.signature, 8)}`;
                })}>
                {busy ? "Depositing…" : "Deposit privately"}
              </button>
            ) : tab === "pay" ? (
              <button className="act" disabled={busy || !amount || !toAddress} onClick={() =>
                run(async (ident) => {
                  const r = await pay({ id: ident, toAddress: toAddress.trim(), amount: toLamports(amount), fee: FEE });
                  return `paid privately — tx ${short(r.signature, 8)}`;
                })}>
                {busy ? "Proving & paying…" : "Pay privately"}
              </button>
            ) : (
              <button className="act" disabled={busy || !amount || !toAddress} onClick={() =>
                run(async (ident) => {
                  const r = await withdraw({ id: ident, toSolAddress: toAddress.trim(), amount: toLamports(amount), fee: FEE });
                  return `withdrawn — tx ${short(r.signature, 8)}`;
                })}>
                {busy ? "Proving & withdrawing…" : "Withdraw"}
              </button>
            )}
          </div>
        </>
      )}

      {status && <div className="readout" style={{ marginTop: 16, color: "#34e7cf" }}>✓ {status}</div>}
      {error && <div className="readout" style={{ marginTop: 16, color: "#ff6b6b" }}>{error}</div>}
    </div>
  );
}
