# Pool (path C) vs. a pool-free design (Arcium / MPC)

You asked whether complete anonymity is possible *without* a pool. Short answer:
the only architecture that plausibly qualifies replaces the **explicit mixing
pool** with a **shared encrypted state** computed by a multi-party network. You
still hide in a crowd — there is no escaping that — but the crowd is maintained
as ciphertext under MPC instead of as a vault you deposit into and withdraw from.

This doc sketches both so you can compare what you already shipped against the
genuinely pool-free option.

## What you have — UTXO shielded pool (path C)

```
deposit ──▶ vault (holds funds) + commitment in a Merkle tree
                                   │
withdraw ◀── ZK proof: "I own one of the N notes" + nullifier
                                   │
            fresh recipient paid by the vault; relayer signs
```

- **Anonymity model:** your withdrawal is indistinguishable from any of the N
  deposits in the tree. Anonymity set = deposits in the pool.
- **Trust:** none for custody (proofs gate every payout). v1 trusts an operator
  for tree liveness; v2 makes the tree fully on-chain.
- **What's public:** that a deposit and a withdrawal happened; **not** which
  funds which. With fixed denominations, amounts don't leak. With Tor, the
  network origin doesn't leak.
- **Maturity:** this is the proven design (Tornado, Zcash, Privacy Cash,
  Elusiv). You have it working end-to-end today.
- **Weak spot:** small anonymity set = weak privacy (now guarded — see
  `POOL_MIN_ANONYMITY_SET` + the UI warning).

## The pool-free option — Arcium (MPC over encrypted state)

Arcium (the team behind Elusiv, after they retired the shielded pool) runs a
network of nodes that compute over **encrypted inputs** via secure multi-party
computation. No node ever sees plaintext.

```
your balance, the transfer amount, the counterparty  ──▶  all ciphertext
                                                            │
        MPC network runs the "transfer" computation on encrypted state
                                                            │
        only encrypted state changes are committed on-chain
```

- **Anonymity model:** there is no deposit/withdraw mixing step. Your transaction
  is one update among many to a shared encrypted state; an observer sees an
  opaque state transition. You still hide in the crowd of everyone using that
  encrypted state — so it's "pool-free" only in the sense that there is no
  explicit deposit→mix→withdraw cycle.
- **Trust:** an honest-majority (or similar) assumption across the MPC node set —
  a *different* trust model than ZK (which is trustless given the setup). You
  trust that fewer than the threshold of nodes collude.
- **What's public:** much less — potentially neither amounts nor the graph, since
  the computation itself is encrypted. This is its big upside.
- **Maturity:** early. You build *on Arcium's network* (an "encrypted
  co-processor"), not a self-contained Solana program you fully control. Latency
  and cost are higher than a single on-chain proof verification.
- **Weak spot:** liveness and security depend on the external MPC network; you
  inherit its trust assumptions and availability.

## Side-by-side

| | Path C (your pool) | Arcium (MPC) |
|---|---|---|
| Hides who↔who | ✅ (unlinkable deposit/withdraw) | ✅ (encrypted state) |
| Hides amount | ✅ via fixed denominations | ✅ natively |
| Explicit pool / mixing step | yes | no |
| Trust model | trustless (ZK) + v1 operator liveness | honest-majority MPC network |
| Anonymity set | deposits in the pool | users of the shared state |
| Self-contained on Solana | ✅ one program you own | ❌ depends on Arcium network |
| Maturity / proven | high | early |
| Working today in this repo | ✅ | ✗ (would be a rewrite onto external infra) |

## Recommendation

Keep path C. It's working, trustless, and self-contained, and the one real
weakness (small anonymity set) is now guarded in code. Arcium is worth watching —
if it matures and you want amounts+graph hidden *without* a mixing step and you
accept the MPC trust assumption, it's the migration target. But it's a different
system built on someone else's network, not an incremental improvement to what
you have. There is no third option that gives complete anonymity with no crowd at
all — that part is information-theoretic, not an engineering gap.
