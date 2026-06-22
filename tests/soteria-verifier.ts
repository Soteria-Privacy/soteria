import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

/**
 * Skeleton integration test for the verify flow.
 * Fill in once the trusted setup has produced a real proof + VERIFYINGKEY.
 *
 *   1. build a Poseidon Merkle set with the SDK (PoseidonMerkleTree)
 *   2. proveCredential(...) -> { proofA, proofB, proofC, publicInputs }
 *   3. program.methods.verify(proofA, proofB, proofC, publicInputs)
 *        .accounts({ payer, nullifier, systemProgram }).rpc()
 *   4. assert a second submit with the same nullifier fails (PDA already init)
 */
describe("soteria_verifier", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  it("verifies a selective-disclosure proof and burns the nullifier", async () => {
    // TODO: implement against generated artifacts
  });
});
