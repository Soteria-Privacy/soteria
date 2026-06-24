import { describe, it, expect } from "vitest";
import { buildPoseidon } from "circomlibjs";
import { computeRoot, computeProof, DEPTH } from "../src/services/merkle.js";

// Folds a leaf up through its Merkle path exactly like the circuit's
// MerkleInclusion template, to prove computeProof yields a valid witness.
describe("computeProof", () => {
  it("produces a path whose recomputed root matches computeRoot", async () => {
    const commitments = ["11", "22", "33", "44", "55"];
    const expectedRoot = await computeRoot(commitments);

    const poseidon = await buildPoseidon();
    const h2 = (a: bigint, b: bigint) => BigInt(poseidon.F.toString(poseidon([a, b])));

    for (let index = 0; index < commitments.length; index++) {
      const { pathElements, pathIndices, root } = await computeProof(commitments, index);
      expect(root).toBe(expectedRoot);

      // Fold the leaf up through the path exactly like the circuit.
      let cur = BigInt(commitments[index]);
      for (let i = 0; i < DEPTH; i++) {
        const sib = BigInt(pathElements[i]);
        cur = pathIndices[i] ? h2(sib, cur) : h2(cur, sib);
      }
      expect(cur.toString()).toBe(expectedRoot);
    }
  });

  it("returns DEPTH-length paths", async () => {
    const { pathElements, pathIndices } = await computeProof(["1", "2"], 0);
    expect(pathElements.length).toBe(DEPTH);
    expect(pathIndices.length).toBe(DEPTH);
  });
});
