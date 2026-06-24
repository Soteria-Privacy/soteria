import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { QRCodeSVG } from "qrcode.react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  deposit,
  withdraw,
  fetchPool,
  claimLink,
  encryptedClaimLink,
  extractClaimCode,
  isEncryptedCode,
  decryptClaim,
  deriveReceiveIdentity,
  SAFE_ANONYMITY_SET,
  type PoolState,
  type Note,
  type ReceiveIdentity,
} from "../lib/pool";
import { short } from "../lib/soteria";

const POOL_ID = Number(import.meta.env.VITE_SOTERIA_POOL_ID ?? 0);
// Relayer fee, in lamports, deducted from the claimed amount.
const DEFAULT_FEE = 5000n;

type Mode = "pay" | "claim";

const initialClaim = () => {
  if (typeof location === "undefined") return "";
  return new URLSearchParams(location.search).get("claim") ?? "";
};

export function PoolPanel({ initialMode }: { initialMode?: Mode }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, signMessage } = useWallet();
  const claimFromUrl = initialClaim();
  const [mode, setMode] = useState<Mode>(initialMode ?? (claimFromUrl ? "claim" : "pay"));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // pay
  const [recipientAddr, setRecipientAddr] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [linkEncrypted, setLinkEncrypted] = useState(false);
  const [depositSig, setDepositSig] = useState<string | null>(null);

  // claim
  const [noteInput, setNoteInput] = useState(claimFromUrl);
  const [recipient, setRecipient] = useState("");
  const [withdrawSig, setWithdrawSig] = useState<string | null>(null);
  const [identity, setIdentity] = useState<ReceiveIdentity | null>(null);

  const [poolState, setPoolState] = useState<PoolState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchPool(POOL_ID).then((s) => alive && setPoolState(s)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const denomSol = poolState ? Number(poolState.denomination) / LAMPORTS_PER_SOL : null;
  const anonSet = poolState?.anonymitySet ?? 0;
  const anonColor = anonSet >= SAFE_ANONYMITY_SET ? "#34e7cf" : anonSet <= 1 ? "#ff6b6b" : "#ffb454";
  const anonLabel =
    anonSet >= SAFE_ANONYMITY_SET
      ? "healthy crowd to hide in"
      : anonSet <= 1
        ? "DANGER: only one deposit — a claim links straight back to the sender"
        : "weak: small crowd, wait for more deposits before claiming";

  const claimCode = noteInput ? extractClaimCode(noteInput) : "";
  const needsDecrypt = claimCode ? isEncryptedCode(claimCode) : false;

  async function reveal() {
    if (!signMessage) {
      setError("this wallet doesn't support message signing");
      return null;
    }
    setError(null);
    try {
      const id = await deriveReceiveIdentity(signMessage);
      setIdentity(id);
      return id;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }

  async function onPay() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    setLink(null);
    setDepositSig(null);
    try {
      const r = await deposit({ connection, depositor: publicKey, sendTransaction, poolId: POOL_ID });
      const addr = recipientAddr.trim();
      if (addr) {
        setLink(await encryptedClaimLink(r.note, addr));
        setLinkEncrypted(true);
      } else {
        setLink(claimLink(r.note));
        setLinkEncrypted(false);
      }
      setDepositSig(r.signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onClaim() {
    if (anonSet < SAFE_ANONYMITY_SET) {
      const msg =
        anonSet <= 1
          ? "Only one deposit is in this pool — claiming now links the funds straight back to the sender. Proceed anyway?"
          : `Only ${anonSet} deposits in the pool. This claim hides in a crowd of ${anonSet}. Proceed anyway?`;
      if (!window.confirm(msg)) return;
    }
    setBusy(true);
    setError(null);
    setWithdrawSig(null);
    try {
      let noteStr = claimCode;
      if (needsDecrypt) {
        const id = identity ?? (await reveal());
        if (!id) return;
        noteStr = await decryptClaim(claimCode, id.priv);
      }
      const recip = new PublicKey(recipient.trim());
      const r = await withdraw({ backup: noteStr, recipient: recip, fee: DEFAULT_FEE });
      setWithdrawSig(r.signature);
    } catch (e) {
      setError((e as Error).message.includes("operation-specific reason")
        ? "could not decrypt — this note isn't encrypted to your address"
        : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Private payments (pool)</h3>
      <p className="sub">
        Pay someone privately: you deposit a fixed amount and get a <strong>claim link</strong>.
        Add their private-payment address and the link is <strong>encrypted to them</strong> —
        safe to send over any channel. They claim it to a <strong>fresh</strong> address with a
        zero-knowledge proof, so no one can link your payment to their wallet.
      </p>
      <span className="status">
        pool #{POOL_ID}
        {denomSol !== null ? ` · ${denomSol} SOL` : ""}
      </span>

      <div className="row" style={{ marginTop: 18 }}>
        <button className={`act ${mode === "pay" ? "" : "ghost"}`} onClick={() => setMode("pay")}>
          Pay privately
        </button>
        <button className={`act ${mode === "claim" ? "" : "ghost"}`} onClick={() => setMode("claim")}>
          Claim
        </button>
      </div>

      {mode === "pay" ? (
        <div style={{ marginTop: 18 }}>
          <label className="k">Recipient's private-payment address (optional)</label>
          <input
            className="input"
            value={recipientAddr}
            placeholder="leave blank for a bearer link (share privately)"
            style={{ width: "100%", marginBottom: 12, fontFamily: "monospace" }}
            onChange={(e) => setRecipientAddr(e.target.value)}
          />
          {!publicKey ? (
            <WalletMultiButton />
          ) : (
            <button className="act" onClick={onPay} disabled={busy}>
              {busy ? "Depositing…" : `Pay ${denomSol ?? ""} SOL privately`}
            </button>
          )}

          {link && (
            <div className="readout" style={{ marginTop: 16 }}>
              <div style={{ color: "#34e7cf", marginBottom: 4 }}>✓ Deposited.</div>
              <div className="sub" style={{ marginBottom: 10 }}>
                {linkEncrypted
                  ? "🔒 Encrypted to the recipient — safe to send over any channel."
                  : "⚠ Bearer link — anyone with it can claim. Share privately."}
              </div>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                <div style={{ background: "#fff", padding: 10, borderRadius: 8 }}>
                  <QRCodeSVG value={link} size={148} />
                </div>
              </div>
              <textarea
                className="input"
                readOnly
                value={link}
                rows={3}
                style={{ width: "100%", fontFamily: "monospace" }}
                onFocus={(e) => e.currentTarget.select()}
              />
              {depositSig && (
                <div style={{ marginTop: 8 }}>
                  <span className="k">deposit tx </span>
                  {short(depositSig, 8)}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <div className="readout" style={{ marginBottom: 14, borderColor: anonColor }}>
            <div style={{ color: anonColor, fontWeight: 600 }}>
              Anonymity set: {anonSet}{poolState ? ` deposit${anonSet === 1 ? "" : "s"}` : "…"}
            </div>
            <div className="sub" style={{ marginTop: 4 }}>{anonLabel}</div>
          </div>

          {/* Your receive address — share it so senders can encrypt to you. */}
          <div className="readout" style={{ marginBottom: 14 }}>
            {identity ? (
              <>
                <div className="k" style={{ marginBottom: 6 }}>Your private-payment address</div>
                <textarea
                  className="input"
                  readOnly
                  value={identity.address}
                  rows={2}
                  style={{ width: "100%", fontFamily: "monospace" }}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div className="sub" style={{ marginTop: 6 }}>
                  Share this with senders so they can encrypt payments to you.
                </div>
              </>
            ) : (
              <button className="act ghost" onClick={reveal} disabled={!signMessage}>
                Reveal my private-payment address
              </button>
            )}
          </div>

          <label className="k">Claim link or note</label>
          <textarea
            className="input"
            value={noteInput}
            placeholder="paste the claim link you received"
            rows={3}
            style={{ width: "100%", fontFamily: "monospace", marginBottom: 6 }}
            onChange={(e) => setNoteInput(e.target.value)}
          />
          {needsDecrypt && (
            <div className="sub" style={{ marginBottom: 12, color: "#b07cff" }}>
              🔒 Encrypted note — you'll be asked to sign to decrypt it with your address.
            </div>
          )}
          <label className="k">Receive at (fresh address)</label>
          <input
            className="input"
            value={recipient}
            placeholder="a new wallet, never linked to the sender"
            style={{ width: "100%", marginBottom: 12 }}
            onChange={(e) => setRecipient(e.target.value)}
          />
          <button
            className="act"
            onClick={onClaim}
            disabled={busy || !noteInput.trim() || !recipient.trim()}
          >
            {busy ? "Proving & claiming…" : "Claim privately"}
          </button>

          {withdrawSig && (
            <div className="readout" style={{ marginTop: 16 }}>
              <div style={{ color: "#34e7cf" }}>✓ Claimed to {short(recipient, 6)}</div>
              <div style={{ marginTop: 8 }}>
                <span className="k">claim tx </span>
                {short(withdrawSig, 8)}
              </div>
              <div className="sub" style={{ marginTop: 8 }}>
                Net {(Number(DEFAULT_FEE) / LAMPORTS_PER_SOL).toFixed(6)} SOL relayer fee.
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="readout" style={{ marginTop: 16, color: "#ff6b6b" }}>
          {error}
        </div>
      )}
    </div>
  );
}
