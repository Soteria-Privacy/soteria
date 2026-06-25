import { motion, type Variants } from "framer-motion";
import { LiveGraph } from "./LiveGraph";

const STEPS = [
  {
    n: "01",
    t: "Share your link",
    d: "One link, one QR. Post it anywhere — it never changes and reveals nothing.",
  },
  {
    n: "02",
    t: "Get paid privately",
    d: "Each payment lands at a fresh address only you can find. Your wallet stays off-chain.",
  },
  {
    n: "03",
    t: "Sweep when ready",
    d: "Move funds to your main wallet anytime, signed with the one-time key.",
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
            Share one link and receive to a fresh, unlinkable address every time. Your
            main wallet never appears on-chain, and only you can see or spend what comes
            in — self-custodial, end to end.
          </motion.p>
          <motion.div className="lp-cta" variants={item}>
            <button className="act" onClick={onPay}>
              Create your payment link
            </button>
            <button className="act ghost" onClick={onPay}>
              Pay someone
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
          <span>Compliant privacy pools</span>
          <span>Auditable by design</span>
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
