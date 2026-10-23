import { useRef, type PointerEvent } from "react";
import { LiveGraph } from "./LiveGraph";
import { DotWordmark } from "./landing/DotWordmark";
import { useLandingMotion } from "./landing/useLandingMotion";

const STEPS = [
  {
    n: "01",
    t: "Deposit any amount",
    d: "Move funds into one shielded balance. The chain records that a deposit happened, never how much you hold.",
  },
  {
    n: "02",
    t: "Pay anyone, privately",
    d: "Send to a shielded address with the amount encrypted. Your wallet is never named as the payer, and any change comes back to you automatically.",
  },
  {
    n: "03",
    t: "Withdraw when ready",
    d: "Cash out to a fresh wallet, with no on-chain trail back to where the funds came from.",
  },
];

const PRIMITIVES = [
  {
    t: "Shielded balance",
    d: "One private balance for any amount. Deposits, payments and change stay encrypted end to end.",
  },
  {
    t: "Stealth receiving",
    d: "One-time receive addresses, so your main wallet never shows up as the recipient.",
  },
  {
    t: "ZK selective disclosure",
    d: "Prove you're eligible or on an allowlist without revealing which identity, verified on-chain with Groth16.",
  },
  {
    t: "Confidential amounts",
    d: "Token-2022 confidential transfers with a mint-level auditor key.",
    note: "localnet",
  },
];

function trackGlow(e: PointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--gx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--gy", `${e.clientY - r.top}px`);
}

export function Landing({ onPay, onEnter }: { onPay: () => void; onEnter: () => void }) {
  const root = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLElement>(null);
  useLandingMotion(root);

  const seeHow = () => {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    stepsRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  return (
    <section className="lp" ref={root}>
      <div className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-pill">
            <span className="lp-pill-dot" />
            Private payments on Solana
          </div>

          <DotWordmark className="lp-wordmark" />
          <p className="lp-kicker">
            <span className="lp-kicker-text">PRIVACY TOOLKIT</span>
          </p>

          <h1 className="lp-title">
            Get paid on Solana,
            <br />
            <span className="accent">privately.</span>
          </h1>
          <p className="lp-lede">
            Deposit into one shielded balance and pay anyone without revealing the amount.
            Your wallet is never named as the payer, and the chain never sees who paid whom.
            Self-custodial, end to end.
          </p>
          <div className="lp-cta">
            <button className="lp-btn lp-btn-primary" onClick={onPay}>
              Open private payments <span aria-hidden="true">→</span>
            </button>
            <button className="lp-btn lp-btn-ghost" onClick={seeHow}>
              See how it works
            </button>
          </div>
        </div>

        <div className="lp-scroll" aria-hidden="true">
          <span className="lp-scroll-dot" />
        </div>
      </div>

      <section className="lp-section" ref={stepsRef} aria-labelledby="lp-how">
        <p className="lp-eyebrow">How it works</p>
        <h2 className="lp-h2" id="lp-how">Three steps. Nothing left on the record.</h2>
        <div className="lp-rail" aria-hidden="true">
          <span className="lp-rail-fill" />
        </div>
        <ol className="lp-steps">
          {STEPS.map((s) => (
            <li className="lp-step" key={s.n} onPointerMove={trackGlow}>
              <span className="lp-step-n">{s.n}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-section lp-ledger" aria-labelledby="lp-ledger">
        <div className="lp-ledger-copy">
          <p className="lp-eyebrow">What the chain sees</p>
          <h2 className="lp-h2" id="lp-ledger">A transfer happened. That's all it learns.</h2>
          <p className="lp-body">
            Explorers can see that funds moved. The amount and the link between payer and
            payee stay encrypted. When you need to prove a payment, you choose what to
            disclose and to whom.
          </p>
        </div>
        <div className="lp-ledger-panel">
          <LiveGraph />
        </div>
      </section>

      <section className="lp-section" aria-labelledby="lp-prims">
        <p className="lp-eyebrow">Under the hood</p>
        <h2 className="lp-h2" id="lp-prims">Privacy primitives, shipped as an open SDK.</h2>
        <ul className="lp-prims">
          {PRIMITIVES.map((p) => (
            <li className="lp-prim" key={p.t} onPointerMove={trackGlow}>
              <h3>
                {p.t}
                {p.note && <span className="lp-prim-note">{p.note}</span>}
              </h3>
              <p>{p.d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-final" aria-labelledby="lp-final">
        <div className="lp-final-inner">
          <h2 className="lp-h2" id="lp-final">Your balance is nobody's business.</h2>
          <div className="lp-trust">
            <span>Self-custodial</span>
            <span>Hidden amounts</span>
            <span>Unlinkable payments</span>
          </div>
          <div className="lp-cta">
            <button className="lp-btn lp-btn-primary" onClick={onPay}>
              Open private payments <span aria-hidden="true">→</span>
            </button>
          </div>
          <p className="lp-dev">
            Building an app? The same primitives ship as an{" "}
            <button className="link-inline" onClick={onEnter}>
              open SDK
            </button>
            <span className="sep">·</span>
            <a href="https://github.com/romeoscript/soteria" target="_blank" rel="noreferrer">
              view source
            </a>
          </p>
        </div>
      </section>
    </section>
  );
}
