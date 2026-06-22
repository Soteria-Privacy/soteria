pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// ---------------------------------------------------------------------------
// Soteria selective-disclosure circuit
//
// Proves: knowledge of a `secret` whose identity commitment Poseidon(secret)
// is a leaf in the published `merkleRoot`, and derives a unique `nullifierHash`
// scoped to `externalNullifier`, WITHOUT revealing which leaf.
//
// Use for: anonymous allowlists, one-person-one-vote, "holds credential X".
// NOT a fund pool — no value is deposited or withdrawn. The nullifier only
// prevents the same identity from acting twice within the same scope.
// ---------------------------------------------------------------------------

template MerkleInclusion(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];   // 0 => current node is left child, 1 => right
    signal output root;

    component hashers[depth];
    component mux[depth];
    signal hashes[depth + 1];
    hashes[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // enforce pathIndices is boolean
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // order the pair (left, right) according to pathIndices[i]
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== hashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== hashes[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];
        hashes[i + 1] <== hashers[i].out;
    }

    root <== hashes[depth];
}

template Credential(depth) {
    // --- private ---
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    // --- public ---
    signal input merkleRoot;
    signal input externalNullifier;  // scope id (e.g. vote round / app id)
    signal input signalHash;         // binds the proof to a message/recipient

    // --- public output ---
    signal output nullifierHash;

    // identity commitment = Poseidon(secret)
    component idc = Poseidon(1);
    idc.inputs[0] <== secret;

    // membership: computed root must equal the public root
    component inc = MerkleInclusion(depth);
    inc.leaf <== idc.out;
    for (var i = 0; i < depth; i++) {
        inc.pathElements[i] <== pathElements[i];
        inc.pathIndices[i] <== pathIndices[i];
    }
    inc.root === merkleRoot;

    // nullifier = Poseidon(secret, externalNullifier)
    component nh = Poseidon(2);
    nh.inputs[0] <== secret;
    nh.inputs[1] <== externalNullifier;
    nullifierHash <== nh.out;

    // constrain signalHash into the proof so it cannot be reused for a
    // different signal (prevents proof replay against another action)
    signal signalHashSq;
    signalHashSq <== signalHash * signalHash;
}

// depth 20 => up to 2^20 (~1M) members
component main {public [merkleRoot, externalNullifier, signalHash]} = Credential(20);
