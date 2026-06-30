# Anonymous relaying over Tor

Soteria's cryptography already hides **who paid whom**: the spender never signs
(the relayer does), and the zero-knowledge proof hides which deposit a withdrawal
came from. What the protocol *cannot* hide on its own is **network metadata** —
the IP address and request timing you reveal to the relayer when you hand it a
proof. A relayer that logs that metadata (or is compelled to) can correlate
"IP X asked to withdraw to wallet Y at time T."

Running over Tor closes that gap: the relayer receives requests through an onion
circuit and never sees a client IP, SNI, or anything it could log or subpoena.

## Why you can't just paste a `.onion` into the hosted app

A normal browser **cannot** fetch a `.onion` URL:

- Chrome/Safari/Firefox have no Tor resolver, so the name doesn't resolve.
- An HTTPS page (like the Vercel deployment) is blocked from calling
  `http://…onion` as **mixed active content**.

So the anonymous path is not "clearnet app → onion relayer." It's **open the
app's own onion mirror in Tor Browser**, where the app *and* the relayer are both
onion services and every request rides the same Tor circuit.

## End-to-end setup (local / self-hosted)

You need [Tor](https://www.torproject.org/) installed (`brew install tor` or
`apt-get install tor`) and [Tor Browser](https://www.torproject.org/download/).

1. **Start the relayer (API).**
   ```bash
   npm run dev:server
   ```

2. **Expose the relayer as an onion service.** In a second terminal:
   ```bash
   bash scripts/onion.sh
   ```
   It prints the relayer onion, e.g. `http://relayerxx…onion`.

3. **Build the frontend and serve its onion mirror.**
   ```bash
   npm -w @soteria/app run build
   bash scripts/onion-app.sh
   ```
   It prints the app onion, e.g. `http://appxx…onion`.

4. **Open the app onion in Tor Browser** (`http://appxx…onion`).

5. **Point the app at the relayer onion.** Click the **privacy badge** in the
   header — it reads `⚠ Clearnet` / `△ Partial` / `🧅 Tor`. Paste the relayer's
   `.onion` into *Relayer endpoint* and hit **Save & reload**. The badge should
   flip to **🧅 Tor**.

At that point the app and relayer are both onion services on the same circuit:
the relayer can't see your IP, and the on-chain link between deposit and
withdrawal is already severed by the proof.

## What this does and doesn't give you

| Threat | Mitigated? |
| --- | --- |
| On-chain observer links your deposit → withdrawal | ✅ ZK proof + shared relayer signer |
| Relayer logs/correlates your **IP / timing** | ✅ once you're on the **🧅 Tor** path |
| Recipient address visible on-chain | ❌ inherent — withdraw to a *fresh* address |
| Relayer **censors / goes down** (single operator) | ❌ — see "Next" below |
| Global adversary doing end-to-end timing on Tor | ⚠️ partial — add delays / fixed denominations |

## Next steps toward fully trustless anonymity

Tor removes the *metadata* leak. To also remove *trust* in a single operator:

- **Permissionless, fee-compensated relayers.** The proof binds the relayer key
  (`extDataHash = keccak(recipient ‖ relayer ‖ extAmount ‖ fee)`), and the
  on-chain `transact` accepts *any* signer — so relaying can be opened to anyone,
  paid out of the spend. A relayer **set** (client picks one at random) removes
  the single-operator censorship/availability risk.
- **Fixed denominations** so amounts don't fingerprint a withdrawal.
- **Submission delays / batching** to defeat timing correlation.
