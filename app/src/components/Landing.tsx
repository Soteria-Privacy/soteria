import { useRef } from "react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { LiveGraph } from "./LiveGraph";

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

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1, delayChildren: 0.12 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const spring = { type: "spring", stiffness: 380, damping: 24 } as const;

export function Landing({ onPay, onEnter }: { onPay: () => void; onEnter: () => void }) {
  const reduce = useReducedMotion();
  const stepsRef = useRef<HTMLDivElement>(null);

  const seeHow = () =>
    stepsRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });

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
            Deposit into one shielded balance and pay anyone without revealing the
            amount. Your wallet is never named as the payer, and the chain never sees
            who paid whom. Self-custodial, end to end.
          </motion.p>
          <motion.div className="lp-cta" variants={item}>
            <motion.button
              className="act"
              onClick={onPay}
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={spring}
            >
              Open private payments
            </motion.button>
            <motion.button
              className="act ghost"
              onClick={seeHow}
              whileHover={reduce ? undefined : { y: -2 }}
              whileTap={reduce ? undefined : { scale: 0.97 }}
              transition={spring}
            >
              See how it works
            </motion.button>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        ref={stepsRef}
        className="lp-steps"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.4 }}
        variants={container}
      >
        {STEPS.map((s) => (
          <motion.div
            className="lp-step"
            key={s.n}
            variants={item}
            whileHover={reduce ? undefined : { y: -6 }}
            transition={spring}
          >
            <span className="lp-step-n">{s.n}</span>
            <h3>{s.t}</h3>
            <p>{s.d}</p>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        className="lp-foot"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.6 }}
        variants={container}
      >
        <motion.div className="lp-trust" variants={item}>
          <span>Self-custodial</span>
          <span>Hidden amounts</span>
          <span>Unlinkable payments</span>
        </motion.div>
        <motion.p className="lp-dev" variants={item}>
          Building an app? The same primitives — stealth payments, ZK disclosure,
          confidential amounts, shielded pools — ship as an{" "}
          <button className="link-inline" onClick={onEnter}>
            open SDK
          </button>
          <span className="sep">·</span>
          <a href="https://github.com/romeoscript/soteria" target="_blank" rel="noreferrer">
            view source
          </a>
        </motion.p>
      </motion.div>
    </section>
  );
}
