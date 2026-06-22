import { useState } from "react";
import { Shield } from "./components/Shield";
import { StealthPanel } from "./components/StealthPanel";
import { CredentialPanel } from "./components/CredentialPanel";
import { ConfidentialPanel } from "./components/ConfidentialPanel";

const TABS = [
  { id: "stealth", label: "Stealth receiving" },
  { id: "credential", label: "Selective disclosure" },
  { id: "confidential", label: "Confidential amounts" },
] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("stealth");

  return (
    <div className="wrap">
      <div className="bar">
        <div className="brand">
          <svg className="mark" viewBox="0 0 24 24" fill="none">
            <path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6l-8-4Z" stroke="#5b8cff" strokeWidth="1.6" />
            <circle cx="12" cy="11" r="2.4" fill="#9d7bff" />
          </svg>
          <div>
            <h1>SOTERIA</h1>
            <div className="tag">solana privacy toolkit</div>
          </div>
        </div>
        <div className="tag">devnet</div>
      </div>

      <section className="hero">
        <div>
          <h2>Privacy that keeps the <em>graph honest</em>.</h2>
          <p>
            Stealth receiving, anonymous credentials, and confidential amounts —
            three primitives that protect users without pooling funds or hiding who
            paid whom. Every feature keeps a disclosure path.
          </p>
          <div className="note">no mixer · no link-severing · auditor-key native</div>
        </div>
        <Shield />
      </section>

      <div className="tabs" role="tablist">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            data-active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <span className="idx">{String(i + 1).padStart(2, "0")}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stealth" && <StealthPanel />}
      {tab === "credential" && <CredentialPanel />}
      {tab === "confidential" && <ConfidentialPanel />}
    </div>
  );
}
