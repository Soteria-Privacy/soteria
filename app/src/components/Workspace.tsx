import { AnimatePresence, motion } from "framer-motion";
import { BorderBeam } from "./ui/border-beam";
import { StealthPanel } from "./StealthPanel";
import { CredentialPanel } from "./CredentialPanel";
import { ConfidentialPanel } from "./ConfidentialPanel";
import { CLUSTER_LABEL, PROGRAM_ID, short } from "../lib/soteria";

const MODULES = [
  { id: "credential", name: "Selective disclosure", sub: "prove membership, hide identity", state: "live" },
  { id: "stealth", name: "Stealth receiving", sub: "one-time receive addresses", state: "live" },
  { id: "confidential", name: "Confidential amounts", sub: "shielded balances", state: "live" },
] as const;

const PANELS = {
  credential: CredentialPanel,
  stealth: StealthPanel,
  confidential: ConfidentialPanel,
};

type Id = (typeof MODULES)[number]["id"];

export function Workspace({ tab, setTab }: { tab: Id; setTab: (id: Id) => void }) {
  const Panel = PANELS[tab];

  return (
    <div className="workspace">
      <aside className="side">
        <div className="side-head">The primitives</div>
        {MODULES.map((m, i) => (
          <motion.button
            key={m.id}
            className="side-item"
            data-active={tab === m.id}
            onClick={() => setTab(m.id)}
            whileTap={{ scale: 0.985 }}
          >
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            <span className="si-body">
              <span className="t-name">{m.name}</span>
              <span className="t-sub">{m.sub}</span>
            </span>
            <span className={`si-state ${m.state}`}>{m.state}</span>
            {tab === m.id && <BorderBeam size={64} duration={5} borderWidth={1.4} />}
          </motion.button>
        ))}
        <div className="side-foot">
          {CLUSTER_LABEL} · program <span className="mono-faint">{short(PROGRAM_ID, 4)}</span>
        </div>
      </aside>

      <main className="work-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="panel-shell"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <Panel />
            <BorderBeam size={170} duration={9} borderWidth={1.3} delay={1.4} />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
