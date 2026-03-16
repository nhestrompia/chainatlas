# ChainAtlas

Monorepo for the ChainAtlas MVP:

- `apps/web`: Vite + React + Three.js frontend
- `apps/party`: PartyKit multiplayer presence server
- `apps/api`: Fastify API for portfolio and protocol registry
- `packages/shared`: shared contracts, schemas, and state types

## Deploy to Cloudflare

### 1) Deploy API to Workers

```bash
npx wrangler login
npm run deploy -w @chainatlas/api
```

Set API secrets/vars before production deploy:

```bash
npx wrangler secret put ETHEREUM_RPC_URL --config apps/api/wrangler.toml
npx wrangler secret put BASE_RPC_URL --config apps/api/wrangler.toml
npx wrangler secret put ALCHEMY_DATA_API_KEY --config apps/api/wrangler.toml
```

`apps/api/wrangler.toml` already includes:
- `compatibility_flags = ["nodejs_compat"]`
- `CRYPTO_WORLD_PROFILE = "mainnet"` (change to `testnet` if needed)

### 2) Deploy PartyKit

```bash
npx partykit login
npm run deploy -w @chainatlas/party
```

This gives you a PartyKit host like `chainatlas.<account>.partykit.dev`.

### 3) Deploy Web to Cloudflare Pages

```bash
npm run deploy -w @chainatlas/web
```

This runs a Vite build and deploys `apps/web/dist` to Pages (`chainatlas-web` project).

Set Pages build-time environment variables:
- `VITE_API_BASE_URL` = your Workers API URL (for example `https://chainatlas-api.<subdomain>.workers.dev`)
- `VITE_PARTYKIT_HOST` = your PartyKit host (for example `chainatlas.<account>.partykit.dev`)
- `VITE_PRIVY_APP_ID`
- `VITE_PRIVY_CLIENT_ID`
- plus any optional `VITE_*` overrides from `.env.example`

Notes:
- SPA routing fallback is configured with `apps/web/public/_redirects`.
- If you use custom domains, update `VITE_API_BASE_URL` and `VITE_PARTYKIT_HOST` to those domains.
