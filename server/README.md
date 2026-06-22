# Soteria backend

Express + TypeScript service backing the three primitives. It is the off-chain
half of the ZK + stealth flows and the **only component that holds keys**:

- **Stealth announcement registry** — senders publish ephemeral keys + view tags;
  recipients scan. Public, unlinkable data only.
- **Member sets** — stores Poseidon identity commitments per set, recomputes the
  canonical Merkle root server-side, and (with an authority key) publishes it into
  the on-chain group's root ring buffer.
- **Proof relay** — accepts a snarkjs proof + public signals, formats the bytes,
  and submits `verify_proof` on-chain with a **relayer** key (with a compute-budget
  bump) so the prover's wallet never appears.

## Architecture

```
src/
  config.ts            zod-validated env + capability flags
  app.ts               createApp(deps) — helmet, CORS, rate-limit, pino, routes
  deps.ts              wires repos (pg|memory) + SolanaService
  index.ts             bootstrap + graceful shutdown
  middleware/          auth (x-api-key), validate (zod), error handler
  routes/              health · announcements · sets · groups · relay
  repositories/        interfaces + Postgres (drizzle) + in-memory impls
  services/
    merkle.ts          server-side Poseidon root (matches the circuit/SDK)
    proof.ts           snarkjs → on-chain byte formatting (matches prover.ts)
    solana.ts          connection + anchor program + tx senders
  db/                  drizzle schema, pg client, SQL migrator
drizzle/               ordered .sql migrations
```

Dependencies are injected (`AppDeps`), so routes are tested against in-memory
fakes; Postgres and on-chain features degrade gracefully when unconfigured (the
server still boots — see `GET /health` `capabilities`).

## Run

```bash
cp server/.env.example server/.env      # fill in DATABASE_URL + keys as needed
npm install
npm -w server run migrate               # if DATABASE_URL is set
npm -w server run dev                    # http://localhost:8787
npm -w server test                       # vitest
```

### Local Postgres (one-time)

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
initdb -D ~/.soteria-pgdata -U postgres --auth=trust          # first time only
pg_ctl -D ~/.soteria-pgdata -o "-p 5433 -k /tmp" -l ~/.soteria-pgdata/server.log start
createdb -p 5433 -h localhost -U postgres soteria             # first time only
# DATABASE_URL=postgres://postgres@localhost:5433/soteria
```

### Generated keys / devnet funding

`server/.env` (gitignored) holds generated `RELAYER_SECRET_KEY` and
`AUTHORITY_SECRET_KEY`. Before `/relay/verify` or `/groups` can submit, fund their
pubkeys on devnet (the CLI faucet is often rate-limited — use
[faucet.solana.com](https://faucet.solana.com) if `airdrop` fails):

```bash
solana airdrop 1 <RELAYER_PUBKEY>  --url devnet
solana airdrop 1 <AUTHORITY_PUBKEY> --url devnet
```

Then bootstrap a group for the credential demo:

```bash
curl -X POST localhost:8787/groups -H "x-api-key: $ADMIN_API_KEY" \
  -H 'content-type: application/json' -d '{"groupId":0,"setId":"demo"}'
```

## API

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | – | status + capability flags |
| POST | `/announce` | – | publish a stealth announcement |
| GET | `/announcements?sinceSlot&limit` | – | scan announcements |
| GET | `/sets/:id` | – | set metadata + commitments |
| POST | `/sets/:id/members` | api key | add commitment, recompute root |
| POST | `/groups` | api key + authority | create on-chain group, link a set |
| POST | `/sets/:id/publish` | api key + authority | publish current root on-chain |
| POST | `/relay/verify` | – (needs relayer) | format + submit `verify_proof` |

Admin routes require `x-api-key: $ADMIN_API_KEY`. On-chain routes return `503`
until the relevant keypair is configured.
