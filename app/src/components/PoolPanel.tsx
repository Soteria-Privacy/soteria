import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { deposit, withdraw, fetchPool, SAFE_ANONYMITY_SET, type PoolState } from "../lib/pool";
import { short } from "../lib/soteria";

const POOL_ID = Number(import.meta.env.VITE_SOTERIA_POOL_ID ?? 0);
// Relayer fee, in lamports, deducted from the withdrawal.
const DEFAULT_FEE = 5000n;

type Tab = "deposit" | "withdraw";

export function PoolPanel() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [tab, setTab] = useState<Tab>("deposit");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [depositSig, setDepositSig] = useState<string | null>(null);

  const [noteInput, setNoteInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [withdrawSig, setWithdrawSig] = useState<string | null>(null);

  const [poolState, setPoolState] = useState<PoolState | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchPool(POOL_ID).then((s) => alive && setPoolState(s)).catch(() => {});
    load();
    const t = setInterval(load, 5000); // keep the anonymity-set count fresh
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const anonSet = poolState?.anonymitySet ?? 0;
  const anonColor = anonSet >= SAFE_ANONYMITY_SET ? "#34e7cf" : anonSet <= 1 ? "#ff6b6b" : "#ffb454";
  const anonLabel =
    anonSet >= SAFE_ANONYMITY_SET
      ? "healthy crowd to hide in"
      : anonSet <= 1
        ? "DANGER: you'd be the only one — a withdrawal links straight back to you"
        : "weak: small crowd, wait for more deposits before withdrawing";

  async function onDeposit() {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    setBackup(null);
    setDepositSig(null);
    try {
      const denomSol = (await fetchPool(POOL_ID)).denomination;
      void denomSol; // shown below; also validates the pool exists
      const r = await deposit({ connection, depositor: publicKey, sendTransaction, poolId: POOL_ID });
      setBackup(r.backup);
      setDepositSig(r.signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onWithdraw() {
    if (anonSet < SAFE_ANONYMITY_SET) {
      const msg =
        anonSet <= 1
          ? "You'd be the only deposit in this pool — withdrawing now links the funds straight back to you. Proceed anyway?"
          : `Only ${anonSet} deposits in the pool. Your withdrawal hides in a crowd of ${anonSet}. Proceed anyway?`;
      if (!window.confirm(msg)) return;
    }
    setBusy(true);
    setError(null);
    setWithdrawSig(null);
    try {
      const recip = new PublicKey(recipient.trim());
      const r = await withdraw({ backup: noteInput.trim(), recipient: recip, fee: DEFAULT_FEE });
      setWithdrawSig(r.signature);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h3>Private pool</h3>
      <p className="sub">
        Deposit a fixed amount, then withdraw to a <strong>fresh</strong> address with a
        zero-knowledge proof. The on-chain link between your deposit and the withdrawal is
        severed — no one can connect the two. Withdrawals are gated by a compliance
        association set and remain auditable.
      </p>
      <span className="status">devnet · pool #{POOL_ID}</span>

      <div className="row" style={{ marginTop: 18 }}>
        <button className={`act ${tab === "deposit" ? "" : "ghost"}`} onClick={() => setTab("deposit")}>
          Deposit
        </button>
        <button className={`act ${tab === "withdraw" ? "" : "ghost"}`} onClick={() => setTab("withdraw")}>
          Withdraw
        </button>
      </div>

      {tab === "deposit" ? (
        <div style={{ marginTop: 18 }}>
          {!publicKey ? (
            <WalletMultiButton />
          ) : (
            <button className="act" onClick={onDeposit} disabled={busy}>
              {busy ? "Depositing…" : "Deposit into the pool"}
            </button>
          )}

          {backup && (
            <div className="readout" style={{ marginTop: 16 }}>
              <div style={{ color: "#ffb454", marginBottom: 8 }}>
                ⚠ Save this note. It is the ONLY way to withdraw — there is no recovery.
              </div>
              <textarea
                className="input"
                readOnly
                value={backup}
                rows={2}
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

          <label className="k">Your saved note</label>
          <textarea
            className="input"
            value={noteInput}
            placeholder="soteria-note-v1:…"
            rows={2}
            style={{ width: "100%", fontFamily: "monospace", marginBottom: 12 }}
            onChange={(e) => setNoteInput(e.target.value)}
          />
          <label className="k">Fresh recipient address</label>
          <input
            className="input"
            value={recipient}
            placeholder="a new wallet you've never linked to this note"
            style={{ width: "100%", marginBottom: 12 }}
            onChange={(e) => setRecipient(e.target.value)}
          />
          <button
            className="act"
            onClick={onWithdraw}
            disabled={busy || !noteInput.trim() || !recipient.trim()}
          >
            {busy ? "Proving & withdrawing…" : "Withdraw privately"}
          </button>

          {withdrawSig && (
            <div className="readout" style={{ marginTop: 16 }}>
              <div style={{ color: "#34e7cf" }}>✓ Withdrawn to {short(recipient, 6)}</div>
              <div style={{ marginTop: 8 }}>
                <span className="k">withdraw tx </span>
                {short(withdrawSig, 8)}
              </div>
              <div className="sub" style={{ marginTop: 8 }}>
                Net {((Number(DEFAULT_FEE) / LAMPORTS_PER_SOL).toFixed(6))} SOL relayer fee.
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
