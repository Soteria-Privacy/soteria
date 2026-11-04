# Deploy

Three pieces: the **program** (on-chain, already deployed), and the **backend +
frontend**, which run together on one VPS managed by
[Dokploy](https://dokploy.com) from `docker-compose.yml`. The SDK is published
to npm (`@soteria1/sdk`) and bundled into the frontend — nothing to host.

```
             ┌──────────────────────── VPS ────────────────────────┐
 browser ──► │ Traefik (Dokploy, TLS) ─┬─► app     :8080  static SPA │
             │                         └─► server  :8787  relayer ──┼─► Solana RPC
             │                                       └─► postgres    │
             └──────────────────────────────────────────────────────┘
```

---

## 1. Provision the VPS

- Ubuntu 24.04, **≥ 2 vCPU / 4 GB RAM / 40 GB disk** (the frontend build compiles
  native deps and needs the memory), e.g. Hetzner CPX21.
- Add your SSH key at creation; disable password login.
- DNS: point two A records at the server IP:
  - `soteriaprivacy.app` → frontend
  - `api.soteriaprivacy.app` → backend

Then on the server, as root:

```bash
bash scripts/vps-bootstrap.sh   # ufw, fail2ban, unattended upgrades, Dokploy
```

Open `http://<server-ip>:3000` **right away** and create the admin account
(the first visitor becomes admin).

## 2. Create the stack in Dokploy

1. *Projects → Create project* → *Create service → Compose*.
2. **Provider:** GitHub → `Soteria-Privacy/soteria`, branch `main`,
   compose path `./docker-compose.yml`.
3. **Environment:** paste `deploy/dokploy.env.example` and fill in real values.
   Use two RPC keys: a server key (`SOLANA_RPC_URL`) and an origin-restricted
   browser key (`VITE_SOLANA_RPC`) — the `VITE_*` values end up in public JS.
4. **Domains:**
   | Service  | Host                     | Port | HTTPS |
   |----------|--------------------------|------|-------|
   | `app`    | `soteriaprivacy.app`     | 8080 | Let's Encrypt |
   | `server` | `api.soteriaprivacy.app` | 8787 | Let's Encrypt |
5. **Deploy.** Check `https://api.soteriaprivacy.app/health` → `{"ok":true,...}`.
6. Enable *Auto Deploy* (GitHub webhook) so pushes to `main` redeploy.

Migrations run on every server boot (idempotent). `VITE_*` values are baked in
at build time — change them, then **redeploy** (not just restart).

> ⚠️ `RELAYER_SECRET_KEY` / `AUTHORITY_SECRET_KEY` sign and pay fees. Keep them
> only in Dokploy's environment, fund both pubkeys, and keep the balances small.

### One-time: initialize a shielded pool (fresh database only)

```bash
curl -X POST https://api.soteriaprivacy.app/shielded \
  -H "content-type: application/json" -H "x-api-key: $ADMIN_API_KEY" \
  -d '{"shieldedId":5}'
```

## 3. Backups

Postgres lives inside the compose stack, so the simplest reliable backup is a
host cron dump (or check whether your Dokploy version offers compose backups):

```bash
# /etc/cron.daily/soteria-pg
docker exec $(docker ps -qf name=postgres) pg_dump -U soteria soteria \
  | gzip > /root/backups/soteria-$(date +%F).sql.gz
find /root/backups -mtime +14 -delete
```

Copy those off the box (e.g. `rclone` to S3/B2).

## 4. Migrating off Railway

1. Deploy the VPS stack (above) on the `api.` / app domains, but **don't flip DNS yet**
   — test via Dokploy's generated `traefik.me` domain first.
2. Pause writes: scale the Railway server down, then copy the database:
   ```bash
   pg_dump "$RAILWAY_DATABASE_URL" --no-owner --no-acl > soteria.sql
   docker exec -i $(docker ps -qf name=postgres) psql -U soteria soteria < soteria.sql
   ```
3. Point DNS at the VPS, set the same relayer/authority keys, redeploy.
4. Once healthy for a few days, delete the Railway project and remove
   `railway.json`, `app/railway.json`, `app/.railwayignore`, `nixpacks.toml`.

## Circuit artifacts

`app/public/*.wasm` / `*.zkey` are committed (exempted in `.gitignore`) because
the build needs them and they **must match the verifying keys compiled into the
on-chain program**. Re-running `scripts/setup-*.sh` generates new random keys
and breaks every proof unless the verifier is redeployed too.

## RPC

Never use the public `api.mainnet-beta.solana.com`: it returns `403` to browsers
(wallet balances show `0`) and rate-limits the relayer. Use Helius / QuickNode /
Triton.

## Notes

- **Mainnet:** the hidden-amount circuit is unaudited and the trusted setup is
  single-contributor — hold only small amounts until there's an audit and a real
  multi-party ceremony.
- **Tor:** to serve the relayer as an onion service on the same VPS, see
  `docs/TOR.md` and `scripts/onion.sh`.
