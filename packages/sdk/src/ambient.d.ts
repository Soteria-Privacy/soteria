declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmPath: string,
      zkeyPath: string
    ): Promise<{
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
      publicSignals: string[];
    }>;
  };
}

declare module "circomlibjs" {
  export function buildPoseidon(): Promise<
    ((inputs: bigint[]) => unknown) & { F: { toString(x: unknown): string } }
  >;
}
