import { motion, type Variants } from "framer-motion";
import { LiveGraph } from "./LiveGraph";

const STEPS = [
  {
    n: "01",
    t: "Deposit any amount",
    d: "Move any amount into one shielded balance. The chain sees a deposit — never how much you hold.",
  },
  {
    n: "02",
    t: "Pay anyone, privately",
    d: "Send any amount to a shielded address. Amounts stay encrypted and your wallet is never the payer — change comes back automatically.",
  },
  {
    n: "03",
    t: "Withdraw when ready",
    d: "Take any amount out to a fresh wallet, with no on-chain link to where it came from.",
  },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.12 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export function Landing({ onPay, onEnter }: { onPay: () => void; onEnter: () => void }) {
  return (
    <section className="lp">
      <div className="lp-hero">
        <motion.div
          className="lp-graph"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: "easeOut" }}
        >
          <LiveGraph />
        </motion.div>
        <div className="lp-scrim" />

        <motion.div className="lp-copy" variants={container} initial="hidden" animate="show">
          <motion.div className="lp-eyebrow" variants={item}>
            <span className="tick" />Private payments on Solana
          </motion.div>
          <motion.h1 className="lp-title" variants={item}>
            Get paid on Solana,
            <br />
            <span className="accent">privately.</span>
          </motion.h1>
          <motion.p className="lp-lede" variants={item}>
            Deposit any amount into one shielded balance and pay anyone privately.
            Amounts stay encrypted, your wallet is never named as the payer, and the
            chain never sees who paid whom — self-custodial, end to end.
          </motion.p>
          <motion.div className="lp-cta" variants={item}>
            <button className="act" onClick={onPay}>
              Open private payments
            </button>
            <button className="act ghost" onClick={onPay}>
              Pay privately
            </button>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="lp-steps"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={container}
      >
        {STEPS.map((s) => (
          <motion.div className="lp-step" key={s.n} variants={item}>
            <span className="lp-step-n">{s.n}</span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </motion.div>
        ))}
      </motion.div>

      <div className="lp-foot">
        <div className="lp-trust">
          <span>Self-custodial</span>
          <span>Hidden amounts</span>
          <span>Unlinkable payments</span>
        </div>
        <p className="lp-dev">
          Building an app? The same primitives — stealth payments, ZK disclosure,
          confidential amounts, shielded pools — ship as an{" "}
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
  );
}
