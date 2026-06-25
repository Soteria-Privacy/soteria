import { buildPoseidon } from "circomlibjs";

/**
 * Poseidon Merkle tree whose hashing matches circuits/credential.circom:
 *   parent = Poseidon(left, right)
 *   leaf   = Poseidon(secret)   // identity commitment
 *
 * Fixed depth; empty slots are filled with a zero subtree so the root is
 * stable. Keep `depth` in sync with the circuit (default 20).
 */
export class PoseidonMerkleTree {
  private poseidon: any;
  private F: any;
  readonly depth: number;
  private zeros: bigint[] = [];
  private layers: bigint[][] = [];

  private constructor(poseidon: any, depth: number) {
    this.poseidon = poseidon;
    this.F = poseidon.F;
    this.depth = depth;
  }

  static async create(depth = 20): Promise<PoseidonMerkleTree> {
    const poseidon = await buildPoseidon();
    const t = new PoseidonMerkleTree(poseidon, depth);
    // precompute zero subtree roots per level
    let cur = 0n;
    t.zeros.push(cur);
    for (let i = 0; i < depth; i++) {
      cur = t.hash2(cur, cur);
      t.zeros.push(cur);
    }
    t.layers = [[]];
    return t;
  }

  private toBig(x: any): bigint {
    return BigInt(this.F.toString(x));
  }

  hash1(a: bigint): bigint {
    return this.toBig(this.poseidon([a]));
  }
  hash2(a: bigint, b: bigint): bigint {
    return this.toBig(this.poseidon([a, b]));
  }

  /** identity commitment for a secret */
  commitment(secret: bigint): bigint {
    return this.hash1(secret);
  }

  /** insert a leaf (already a commitment) and return its index */
  insert(leaf: bigint): number {
    const index = this.layers[0].length;
    this.layers[0].push(leaf);
    this.rebuild();
    return index;
  }

  /**
   * Insert many leaves and rebuild once — O(n) total instead of O(n²) from
   * calling insert() in a loop. Use this to load a tree from a commitment list.
   */
  insertMany(leaves: bigint[]): void {
    for (const leaf of leaves) this.layers[0].push(leaf);
    this.rebuild();
  }

  private rebuild() {
    for (let level = 0; level < this.depth; level++) {
      const cur = this.layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) {
        const left = cur[i];
        const right = i + 1 < cur.length ? cur[i + 1] : this.zeros[level];
        next.push(this.hash2(left, right));
      }
      this.layers[level + 1] = next;
    }
  }

  root(): bigint {
    const top = this.layers[this.depth];
    return top && top.length ? top[0] : this.zeros[this.depth];
  }

  /** Merkle proof for the leaf at `index`, formatted for the circuit. */
  proof(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      const cur = this.layers[level] ?? [];
      const isRight = idx % 2;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      const sibling =
        siblingIdx < cur.length ? cur[siblingIdx] : this.zeros[level];
      pathElements.push(sibling);
      pathIndices.push(isRight);
      idx = Math.floor(idx / 2);
    }
    return { pathElements, pathIndices };
  }
}
