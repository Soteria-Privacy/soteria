import { useState } from "react";
import { zk, relayVerify, GROUP_ID, EXTERNAL_NULLIFIER, SERVER } from "../lib/soteria";

const WASM = "/credential.wasm";
const ZKEY = "/credential_final.zkey";
const SIGNAL_HASH = 1n;

type Status =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "ok"; signature: string }
  | { kind: "error"; message: string };

export function CredentialPanel() {
  const [secret, setSecret] = useState("12345");
  const [root, setRoot] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function proveAndRelay() {
    try {
      setStatus({ kind: "busy", step: "Building membership set…" });
      const tree = await zk.PoseidonMerkleTree.create(20);
      const mySecret = BigInt(secret);
      // a few decoy members so the set isn't a singleton
      [111n, 222n, 333n].forEach((s) => tree.insert(tree.commitment(s)));
      const leafIndex = tree.insert(tree.commitment(mySecret));
      setRoot(tree.root().toString());

      setStatus({ kind: "busy", step: "Generating proof in your browser…" });
      const raw = await zk.proveCredentialRaw(
        { secret: mySecret, tree, leafIndex, externalNullifier: EXTERNAL_NULLIFIER, signalHash: SIGNAL_HASH },
        WASM,
        ZKEY
      );

      setStatus({ kind: "busy", step: "Relaying to the verifier…" });
      const res = await relayVerify(GROUP_ID, raw);
      if (res.ok && res.signature) {
        setStatus({ kind: "ok", signature: res.signature });
      } else {
        setStatus({
          kind: "error",
          message:
            res.code === "unknown_root"
              ? "Proof is valid, but this set's root isn't published to the on-chain group yet."
              : res.error ?? "relay failed",
        });
      }
    } catch (e) {
      setStatus({ kind: "error", message: friendly(e) });
    }
  }

  return (
    <div className="panel">
      <h3>ZK selective disclosure</h3>
      <p className="sub">
        Prove you belong to a published set — an allowlist, an electorate, a credential
        holder list — without revealing which member you are. A scoped nullifier stops
        you from acting twice.
      </p>
      <span className="status">devnet · relayed</span>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="field">
          <label>identity secret</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button
          className="act"
          onClick={proveAndRelay}
          disabled={status.kind === "busy"}
        >
          {status.kind === "busy" ? status.step : "Prove membership & relay"}
        </button>
      </div>

      {root && (
        <div className="readout">
          <div><span className="k">merkle root </span>{root.slice(0, 24)}…</div>
          <div><span className="k">your leaf   </span><span className="shielded">hidden in proof</span></div>
        </div>
      )}
      {status.kind === "ok" && (
        <div className="readout ok" style={{ marginTop: 10 }}>
          <span className="ok">verified on-chain · </span>
          <a
            href={`https://explorer.solana.com/tx/${status.signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            {status.signature.slice(0, 16)}…
          </a>
        </div>
      )}
      {status.kind === "error" && (
        <div className="readout" style={{ marginTop: 10 }}>
          <span className="k">relay </span>{status.message}
        </div>
      )}

      <p className="hint">
        The proof is generated in your browser from <code>/credential.wasm</code> +
        <code> credential_final.zkey</code> and submitted via the relayer at {SERVER},
        so your wallet never appears on-chain. An operator must first create the group
        and publish this set's root.
      </p>
    </div>
  );
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/wasm|zkey|fetch|404/i.test(msg)) {
    return "Could not load circuit artifacts — run scripts/setup.sh so app/public has the wasm + zkey.";
  }
  return msg;
}
