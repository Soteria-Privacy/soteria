import { motion, type Variants } from "framer-motion";
import { LiveGraph } from "./LiveGraph";
import { AuroraText } from "./ui/aurora-text";
import { Meteors } from "./ui/meteors";
import { Marquee } from "./ui/marquee";
import { Spotlight } from "./ui/spotlight";

const CREDS = [
  "one shareable link", "fresh address per payment", "self-custodial", "no mixer",
  "your wallet stays hidden", "ed25519 stealth", "sweep anytime", "open SDK",
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export function Landing({ onPay, onEnter }: { onPay: () => void; onEnter: () => void }) {
  return (
    <section className="hero-full">
      <div className="hero-bg">
        <Spotlight className="spot-1" fill="#5bd1ff" />
        <Spotlight className="spot-2" fill="#b07cff" />
        <motion.div
          className="hero-graph"
          initial={{ opacity: 0, scale: 1.12 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: "easeOut" }}
        >
          <LiveGraph />
        </motion.div>
        <div className="meteor-field">
          <Meteors number={16} angle={235} />
        </div>
        <div className="hero-scrim" />
      </div>

      <motion.div className="hero-center" variants={container} initial="hidden" animate="show">
        <motion.div className="eyebrow centered" variants={item}>
          Solana · self-custodial · no mixer
        </motion.div>
        <motion.h1 variants={item}>
          Get paid on Solana,
          <br />
          <AuroraText colors={["#34e7cf", "#5bd1ff", "#34e7cf"]}>privately</AuroraText>.
        </motion.h1>
        <motion.p variants={item}>
          Share one link and receive to a fresh, unlinkable address every time. Your
          main wallet never shows up on-chain — and nobody but you can see or spend it.
          No mixer, no custody.
        </motion.p>
        <motion.div className="cta-row centered" variants={item}>
          <button className="act" onClick={onPay}>Create your payment link →</button>
          <button className="act ghost" onClick={onPay}>Pay someone</button>
        </motion.div>
        <motion.div className="dev-note" variants={item}>
          Building an app? Soteria's privacy primitives — stealth payments, ZK
          disclosure, confidential amounts — ship as an{" "}
          <button className="link-inline" onClick={onEnter}>open SDK</button>
          {" · "}
          <a href="https://github.com/romeoscript/soteria" target="_blank" rel="noreferrer">
            view source
          </a>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero-marquee"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.9, duration: 0.6 }}
      >
        <Marquee className="creds" pauseOnHover>
          {CREDS.map((c) => (
            <span className="cred-chip" key={c}>
              <span className="dot" />{c}
            </span>
          ))}
        </Marquee>
      </motion.div>
    </section>
  );
}
