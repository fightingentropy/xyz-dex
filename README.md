# Trade XYZ

Trade XYZ is a front-end trading UI built with SolidJS and Vite. It shows
real-time market data, an interactive candlestick chart, an order book, and
basic trade controls. The app is client-only and pulls data directly from
Hyperliquid and Lighter APIs.

## Features
- Trade view with market stats, chart, order book, and order form
- Portfolio view and simple mobile navigation
- Symbol search modal with keyboard shortcuts
- Candlestick chart with volume and moving averages
- Local caching for chart data and UI settings
- Portfolio margin mode with cross-asset spot collateral haircuts

## Portfolio margin
Trade XYZ includes a portfolio margin mode for perps. When enabled, spot
holdings (with per-asset haircuts) join a cross-asset collateral pool shared
across all perp positions. The pool is perps balances + weighted spot equity +
total unrealized PnL. Use the Margin Mode button in the order form to switch
between Classic and Portfolio. Full definitions and formulas live in
`specs.md`.

## Data sources and caching
- REST data:
  - Hyperliquid perps/spot/equity metadata and market stats
  - Lighter perps/spot market stats and funding rates
- Websocket data:
  - Live kline updates from `wss://api.hyperliquid.xyz/ws`
- Caching:
  - Candle data cached in `localStorage` per symbol and resolution
  - Last selected symbol saved so refreshes return to the same market
  - Chart settings and order book visibility stored in `localStorage`
- Performance behavior:
  - Live polling and streaming pause when the tab is hidden
  - Stale requests are aborted on symbol changes

## Project structure
- `src/App.tsx`: top-level layout and page switching
- `src/components`: UI components (chart, order book, forms)
- `src/stores`: SolidJS signal stores for market data, routing, and cache
- `src/lib/hyperliquid.ts`: Hyperliquid API helpers and formatting utilities

## Development
Install dependencies:

```sh
bun install
```

Create `.env.local` with at least:

```
# Convex will set CONVEX_DEPLOYMENT when you run convex dev the first time
VITE_CONVEX_URL=http://127.0.0.1:3210

# Custom auth (Convex) – local dev
CUSTOM_AUTH_ISSUER=http://127.0.0.1:3210
CUSTOM_AUTH_JWKS_URL=http://127.0.0.1:3210/http/.well-known/jwks.json
CUSTOM_AUTH_AUDIENCE=trade-xyz
CUSTOM_AUTH_PRIVATE_KEY=...   # see Auth section below
CUSTOM_AUTH_PUBLIC_JWK=...   # see Auth section below
```

**One-time Convex setup (use an interactive terminal – e.g. Terminal.app):**

1. Log in and create/link a project (Convex will prompt for device name and project):
   ```sh
   bun x convex dev --env-file .env.local --local
   ```
2. When prompted, choose to create a new project or use an existing one. Convex will write `CONVEX_DEPLOYMENT` to `.env.local` and start the local backend. Stop it with Ctrl+C when ready.

**If you see WebSocket 101/1006 errors** when running Convex with Bun, the CLI’s sync has a known issue with Bun’s WebSocket. Workaround: install Node (e.g. `brew install node`) and run the Convex backend with Node only: `npx convex dev --env-file .env.local --local` in one terminal, then `bun run dev:ui` in another. The rest of the project stays on Bun.

After that, start the dev servers (Convex + Vite):

```sh
bun run dev
```

Or run Convex and Vite separately: `bun run dev:convex` in one terminal, `bun run dev:ui` in another.

Build and preview:

```sh
bun run build
bun run preview
```

## Auth (custom JWT)
This project uses a custom email/password flow backed by Convex (no Auth0).
Generate an RSA key pair and derive a public JWK for the JWKS endpoint.

Generate a local RSA key:

```
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out dev_private.pem
```

Then flatten it for `.env.local`:

```
awk 'BEGIN{printf "CUSTOM_AUTH_PRIVATE_KEY="} {printf "%s\\n",$0} END{print ""}' dev_private.pem
```

Generate the public JWK (single line) and paste into `CUSTOM_AUTH_PUBLIC_JWK`:

```
node -e "const { createPublicKey } = require('crypto'); const fs = require('fs'); const key = fs.readFileSync('dev_private.pem'); const jwk = createPublicKey(key).export({ format: 'jwk' }); jwk.use='sig'; jwk.alg='RS256'; jwk.kid='trade-xyz-dev'; console.log(JSON.stringify(jwk));"
```

If you change `kid`, also set `CUSTOM_AUTH_KEY_ID` to match.

## Production (Convex + Cloudflare Pages)
### Convex (backend)
Set these environment variables in the Convex production deployment:

```
CUSTOM_AUTH_ISSUER=https://earnest-ram-681.convex.site
CUSTOM_AUTH_JWKS_URL=https://earnest-ram-681.convex.site/.well-known/jwks.json
CUSTOM_AUTH_AUDIENCE=trade-xyz
CUSTOM_AUTH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nREPLACE_ME\n-----END PRIVATE KEY-----
CUSTOM_AUTH_PUBLIC_JWK={"kty":"RSA","kid":"trade-xyz-prod","use":"sig","alg":"RS256","n":"REPLACE_ME","e":"AQAB"}
# Optional: override the kid used in JWT headers
# CUSTOM_AUTH_KEY_ID=trade-xyz-prod
```

Deploy the Convex functions:

```sh
CONVEX_DEPLOYMENT=prod:earnest-ram-681 bun x convex deploy --yes
```

If your project is already configured, this also works:

```sh
bun x convex deploy --prod
```

Redeploy after changing Convex environment variables or schema.

### Cloudflare Pages (frontend)
Set build output to `dist`, build command to `bun run build`, and set:

```
VITE_CONVEX_URL=https://earnest-ram-681.convex.cloud
```

Rebuild after changing `VITE_CONVEX_URL`.

### Optional local production build
If you want a local prod build, you can create `.env.production` with just:

```
VITE_CONVEX_URL=https://earnest-ram-681.convex.cloud
```

Keep private keys and Convex secrets in the Convex dashboard, not in frontend
env files.

## Notes
- Routes are handled manually via `window.history`:
  - `/trade` or `/trade/SYMBOL`
  - `/portfolio`
- The app expects network access to Hyperliquid and Lighter endpoints for live data.
