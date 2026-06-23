import { useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { QRCodeSVG } from "qrcode.react";
import {
  DERIVE_MESSAGE,
  decodeMeta,
  payLink,
  sendPrivate,
  scanPayments,
  sweep,
  fmtSol,
  type StealthKeys,
  type DetectedPayment,
} from "../lib/stealthPay";
import { stealth, short } from "../lib/soteria";

type Mode = "receive" | "send";

const payParam = () =>
  typeof location !== "undefined" ? new URLSearchParams(location.search).get("pay") : null;

export function PayApp() {
  const initialMode: Mode = payParam() ? "send" : "receive";
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <section className="pay">
      <div className="pay-head">
        <h2>Private payments</h2>
        <p className="sub">
          Share one link and get paid to fresh, unlinkable addresses every time. Your
          main wallet never appears on-chain. Powered by stealth addresses — no mixer,
          no custody.
        </p>
        <div className="seg">
          <button className={mode === "receive" ? "on" : ""} onClick={() => setMode("receive")}>
            Receive
          </button>
          <button className={mode === "send" ? "on" : ""} onClick={() => setMode("send")}>
            Send
          </button>
        </div>
      </div>
      {mode === "receive" ? <Receive /> : <Send />}
    </section>
  );
}

function Receive() {
  const { connection } = useConnection();
  const { publicKey, signMessage } = useWallet();
  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [payments, setPayments] = useState<DetectedPayment[] | null>(null);
  const [swept, setSwept] = useState<Record<string, string>>({});

  const link = useMemo(() => (keys ? payLink(keys.meta) : ""), [keys]);

  async function createIdentity() {
    setError(null);
    if (!signMessage) {
      setError("Your wallet doesn't support message signing. Try Phantom, Solflare, or Backpack.");
      return;
    }
    try {
      setBusy("Sign in your wallet to derive your keys…");
      const signature = await signMessage(DERIVE_MESSAGE);
      setKeys(stealth.deriveStealthKeys(signature));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not derive keys");
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    if (!keys) return;
    setError(null);
    setBusy("Scanning the registry for payments…");
    try {
      setPayments(await scanPayments({ connection, keys }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setBusy(null);
    }
  }

  async function claim(p: DetectedPayment) {
    if (!publicKey) return;
    setError(null);
    setBusy("Sweeping to your wallet…");
    try {
      const sig = await sweep({ connection, payment: p, destination: publicKey });
      setSwept((s) => ({ ...s, [p.address]: sig }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "sweep failed");
    } finally {
      setBusy(null);
    }
  }

  if (!publicKey) {
    return (
      <div className="panel">
        <p className="sub">Connect a wallet to create your private payment link.</p>
        <div className="row"><WalletMultiButton /></div>
      </div>
    );
  }

  return (
    <div className="panel">
      {!keys ? (
        <>
          <h3>Your payment link</h3>
          <p className="sub">
            One signature derives your private receiving keys. They're recoverable from
            your wallet anytime — nothing is stored.
          </p>
          <div className="row">
            <button className="act" onClick={createIdentity} disabled={!!busy}>
              {busy ?? "Create my payment link"}
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>Your payment link</h3>
          <div className="qr-wrap">
            <div className="qr"><QRCodeSVG value={link} size={148} bgColor="transparent" fgColor="#cdeee7" /></div>
            <div className="qr-side">
              <p className="sub">Share this link or QR. Anyone can pay you; only you can see and spend it.</p>
              <div className="linkbox">
                <code>{short(link, 18)}</code>
                <button
                  className="mini"
                  onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                >
                  {copied ? "copied" : "copy"}
                </button>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button className="act" onClick={refresh} disabled={!!busy}>
              {busy ?? "Check for payments"}
            </button>
          </div>

          {payments && (
            <div className="readout" style={{ marginTop: 12 }}>
              {payments.length === 0 ? (
                <div><span className="k">incoming </span>none yet — share your link</div>
              ) : (
                payments.map((p) => (
                  <div key={p.address} className="payrow">
                    <span className="shielded">{fmtSol(p.lamports)} SOL</span>
                    <span className="k"> at </span>{short(p.address)}
                    {swept[p.address] ? (
                      <a
                        className="ok"
                        href={`https://explorer.solana.com/tx/${swept[p.address]}?cluster=devnet`}
                        target="_blank" rel="noreferrer"
                      > swept ↗</a>
                    ) : (
                      <button className="mini" onClick={() => claim(p)} disabled={!!busy}>sweep to wallet</button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
      {error && <div className="readout" style={{ marginTop: 10 }}><span className="k">error </span>{error}</div>}
      <p className="hint">
        Each payment lands at a fresh one-time address derived from your link. An
        observer can't tie those addresses to each other or to your wallet. Sweeping
        moves the funds to your connected wallet, signed with the one-time key.
      </p>
    </div>
  );
}

function Send() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [metaStr, setMetaStr] = useState(payParam() ?? "");
  const [sol, setSol] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ signature: string; stealthAddress: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setError(null);
    setResult(null);
    if (!publicKey || !sendTransaction) { setError("connect a wallet to send"); return; }
    let meta;
    try { meta = decodeMeta(metaStr.trim()); } catch { setError("invalid payment link"); return; }
    const amount = parseFloat(sol);
    if (!Number.isFinite(amount) || amount <= 0) { setError("enter a valid amount"); return; }
    setBusy(true);
    try {
      const r = await sendPrivate({
        connection, sender: publicKey,
        sendTransaction: (tx, c) => sendTransaction(tx, c),
        meta, sol: amount,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "payment failed");
    } finally {
      setBusy(false);
    }
  }

  if (!publicKey) {
    return (
      <div className="panel">
        <p className="sub">Connect a wallet to send a private payment.</p>
        <div className="row"><WalletMultiButton /></div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Send a private payment</h3>
      <div className="row" style={{ marginTop: 14 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>recipient payment link</label>
          <input value={metaStr} onChange={(e) => setMetaStr(e.target.value)} placeholder="paste a soteria pay link or code" />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label>amount (SOL)</label>
          <input value={sol} onChange={(e) => setSol(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <div className="row">
        <button className="act" onClick={pay} disabled={busy}>
          {busy ? "Sending privately…" : "Send privately"}
        </button>
      </div>

      {result && (
        <div className="readout ok" style={{ marginTop: 12 }}>
          <div><span className="k">sent to </span><span className="shielded">{short(result.stealthAddress)}</span> (one-time)</div>
          <div>
            <span className="k">tx </span>
            <a href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`} target="_blank" rel="noreferrer">
              {short(result.signature)} ↗
            </a>
          </div>
        </div>
      )}
      {error && <div className="readout" style={{ marginTop: 10 }}><span className="k">error </span>{error}</div>}
      <p className="hint">
        Your wallet pays a fresh one-time address derived from the recipient's link —
        their main wallet never appears in this transaction. The recipient detects and
        sweeps it with their private view key.
      </p>
    </div>
  );
}
