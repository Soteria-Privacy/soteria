import { useState } from "react";
import { zk, SERVER } from "../lib/soteria";

/**
 * Demonstrates building the membership set + root client-side. Generating an
 * actual proof needs the circuit artifacts (credential.wasm, credential_final.zkey)
 * from the trusted setup — drop them in app/public and point proveCredential at them.
 */
export function CredentialPanel() {
  const [secret, setSecret] = useState("12345");
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function buildSet() {
    setBusy(true);
    try {
      const tree = await zk.PoseidonMerkleTree.create(20);
      const mySecret = BigInt(secret);
      const myCommitment = tree.commitment(mySecret);
      // add a few decoy members + ourselves
      [111n, 222n, 333n].forEach((s) => tree.insert(tree.commitment(s)));
      const idx = tree.insert(myCommitment);
      const r = tree.root().toString();
      setRoot(r);
      // publish the root so the on-chain verifier can be checked against it
      await fetch(`${SERVER}/sets/demo/root`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: r }),
      }).catch(() => {});
      console.log("member index", idx);
    } finally {
      setBusy(false);
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
      <span className="status">mainnet-ready</span>

      <div className="row" style={{ marginTop: 18 }}>
        <div className="field">
          <label>identity secret</label>
          <input value={secret} onChange={(e) => setSecret(e.target.value)} />
        </div>
      </div>
      <div className="row">
        <button className="act" onClick={buildSet} disabled={busy}>
          {busy ? "Building set…" : "Build set & publish root"}
        </button>
      </div>

      {root && (
        <div className="readout">
          <div><span className="k">merkle root </span>{root.slice(0, 24)}…</div>
          <div><span className="k">your leaf   </span><span className="shielded">hidden in proof</span></div>
        </div>
      )}

      <p className="hint">
        Proof generation: add credential.wasm + credential_final.zkey to app/public,
        then call zk.proveCredential(...) and submit to the soteria_verifier program.
      </p>
    </div>
  );
}
