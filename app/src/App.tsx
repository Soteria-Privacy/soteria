import { useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { Landing } from "./components/Landing";
import { Workspace } from "./components/Workspace";
import { PayApp } from "./components/PayApp";
import { History } from "./components/History";
import { PoolPanel } from "./components/PoolPanel";

type View = "landing" | "app" | "pay" | "history" | "pool";
type Module = "credential" | "stealth" | "confidential";

function initialView(): View {
  if (typeof location === "undefined") return "landing";
  const params = new URLSearchParams(location.search);
  if (params.get("pay") !== null || location.hash === "#pay") return "pay";
  if (location.hash === "#history") return "history";
  if (params.get("claim") !== null || location.hash === "#pool" || location.hash === "#claim")
    return "pool";
  if (location.hash === "#app") return "app";
  return "landing";
}

function Sigil() {
  return (
    <svg className="sigil" viewBox="0 0 40 40" fill="none">
      <path d="M20 3 6 9v9c0 8 6 13 14 16 8-3 14-8 14-16V9L20 3Z" stroke="#34e7cf" strokeWidth="1.4" opacity="0.45" />
      <circle cx="14" cy="17" r="2.3" fill="#34e7cf" />
      <circle cx="26" cy="23" r="2.3" fill="#b07cff" />
      <line x1="14" y1="17" x2="26" y2="23" stroke="#34e7cf" strokeWidth="1.2" opacity="0.7" />
    </svg>
  );
}

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [tab, setTab] = useState<Module>("credential");

  return (
    <MotionConfig reducedMotion="user">
      <div className="aurora" />
      <div className="grid" />
      <div className="grain" />

      <div className="wrap">
        <header className="bar">
          <button className="brand" onClick={() => setView("landing")} aria-label="Home">
            <Sigil />
            <div>
              <h1>SOTERIA</h1>
              <div className="tag">privacy toolkit</div>
            </div>
          </button>
          <nav className="bar-right">
            {view !== "pay" && (
              <button className="nav-link" onClick={() => setView("pay")}>payments</button>
            )}
            {view !== "pool" && (
              <button className="nav-link" onClick={() => setView("pool")}>pool</button>
            )}
            {view !== "history" && (
              <button className="nav-link" onClick={() => setView("history")}>history</button>
            )}
            {view !== "landing" && (
              <button className="nav-link" onClick={() => setView("landing")}>← home</button>
            )}
            <span className="tag pill">devnet</span>
            <WalletMultiButton />
          </nav>
        </header>

        <AnimatePresence mode="wait">
          {view === "landing" ? (
            <motion.div
              key="landing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4 }}
            >
              <Landing onPay={() => setView("pay")} onEnter={() => setView("app")} />
            </motion.div>
          ) : view === "pay" ? (
            <motion.div
              key="pay"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <PayApp />
            </motion.div>
          ) : view === "history" ? (
            <motion.div
              key="history"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <History onPay={() => setView("pay")} />
            </motion.div>
          ) : view === "pool" ? (
            <motion.div
              key="pool"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <section className="pay">
                <PoolPanel />
              </section>
            </motion.div>
          ) : (
            <motion.div
              key="app"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <Workspace tab={tab} setTab={setTab} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
