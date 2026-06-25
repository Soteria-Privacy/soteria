# @soteria/sdk

Client SDK for **Soteria** — privacy primitives for Solana. Runs in the browser
(keys never leave the device) or Node.

```bash
npm install @soteria/sdk
```

## Modules

```ts
import { shielded, pool, zk, stealth, confidential } from "@soteria/sdk";
```

| Module | What it does |
|--------|--------------|
| **`shielded`** | Hidden-amount UTXO payments: deposit any amount, pay anyone (amounts encrypted), change + multi-recipient, scan for incoming notes. |
| **`pool`** | Fixed-denomination compliant privacy pool (ZK deposit/withdraw, association set). |
| **`zk`** | ZK selective disclosure: prove set membership without revealing identity; Poseidon Merkle tree. |
| **`stealth`** | Dual-key stealth addresses (one-time receive addresses). |
| **`confidential`** | Token-2022 confidential-transfer helpers (hidden amounts with an auditor key). |

## Example — a private payment (shielded)

```ts
import { shielded } from "@soteria/sdk";

// derive a recoverable shielded identity from a wallet signature
const me = await shielded.deriveShieldedKeypair(signature);
const address = shielded.encodeShieldedAddress(me); // share this to get paid

// build a transfer proof (amounts hidden, change handled)
const tx = await shielded.buildTransaction({
  inputs, outputs, spendKeypair: me,
  extAmount: 0n, fee: 5000n, recipient, relayer, root,
  wasmPath: "/transaction.wasm", zkeyPath: "/transaction_final.zkey",
});

// find notes paid to you
const mine = await shielded.scanOutputs(records, me);
const total = shielded.balance(mine);
```

Proof artifacts (`transaction.wasm`, `transaction_final.zkey`) come from the
project's trusted setup (`scripts/setup-transaction.sh`); serve them statically.

## ⚠️ Status

Experimental. The ZK circuits are **unaudited** and the trusted setups are
single-contributor (dev). **Do not use with real funds** without a professional
audit and a real multi-party ceremony.

MIT licensed.
