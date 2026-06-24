import { useEffect, useState } from "react";
import { getActivity, onActivityChange, type Activity } from "../lib/payStore";
import { fmtSol } from "../lib/stealthPay";
import { short } from "../lib/soteria";

const STATUS: Record<Activity["status"], { label: string; cls: string }> = {
  sent: { label: "sent", cls: "k" },
  received: { label: "detected", cls: "k" },
  sweeping: { label: "arriving", cls: "k" },
  swept: { label: "in wallet", cls: "ok" },
  failed: { label: "failed", cls: "bad" },
};

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function History({ onPay }: { onPay: () => void }) {
  const [items, setItems] = useState<Activity[]>(() => getActivity());
  const [filter, setFilter] = useState<"all" | "received" | "sent">("all");

  useEffect(() => onActivityChange(() => setItems(getActivity())), []);

  const shown = items.filter((i) => filter === "all" || i.kind === filter);
  const received = items.filter((i) => i.kind === "received" && i.status === "swept");
  const totalIn = received.reduce((s, i) => s + i.lamports, 0);

  return (
    <section className="pay">
      <div className="pay-head">
        <h2>Payment history</h2>
        <p className="sub">
          Everything you've sent and received through your link, kept on this device.
          Received totals count funds already swept to your wallet.
        </p>
      </div>

      <div className="panel">
        <div className="hist-top">
          <div className="hist-stat">
            <span className="hist-stat-n">{fmtSol(totalIn)}</span>
            <span className="hist-stat-l">SOL received</span>
          </div>
          <div className="seg">
            {(["all", "received", "sent"] as const).map((f) => (
              <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <div className="hist-empty">
            <p className="sub">No payments yet.</p>
            <button className="act" onClick={onPay}>Open payments</button>
          </div>
        ) : (
          <div className="hist-list">
            {shown.map((i) => (
              <div key={i.kind + i.id} className="hist-row">
                <span className={`dir ${i.kind}`}>{i.kind === "sent" ? "↑" : "↓"}</span>
                <span className="amt">{i.lamports ? fmtSol(i.lamports) : "—"} <em>SOL</em></span>
                <span className="addr k">{short(i.address || i.id)}</span>
                <span className={`st ${STATUS[i.status].cls}`}>{STATUS[i.status].label}</span>
                <span className="t k">{when(i.ts)}</span>
                {i.sig ? (
                  <a className="lnk" href={`https://explorer.solana.com/tx/${i.sig}?cluster=devnet`} target="_blank" rel="noreferrer">↗</a>
                ) : (
                  <span className="lnk" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
