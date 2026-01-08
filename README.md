# Trade XYZ

Trade XYZ is a front-end trading UI built with SolidJS and Vite. It shows
real-time market data, an interactive candlestick chart, an order book, and
basic trade controls. The app is client-only and pulls data directly from
Binance Futures APIs and websockets.

## Features
- Trade view with market stats, chart, order book, and order form
- Portfolio view and simple mobile navigation
- Symbol search modal with keyboard shortcuts
- Candlestick chart with volume and moving averages
- Local caching for chart data and UI settings

## Data sources and caching
- REST data:
  - Ticker, premium index, and open interest from Binance Futures
  - Order book depth from Binance Futures
- Websocket data:
  - Live kline updates from `wss://fstream.binance.com`
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
- `src/lib/binance.ts`: Binance API helpers and formatting utilities

## Development
Install dependencies and start the dev server:

```sh
npm install
npm run dev
```

If you prefer Bun:

```sh
bun install
bun run dev
```

Build and preview:

```sh
npm run build
npm run preview
```

## Auth (custom JWT)
This project uses a custom email/password flow backed by Convex (no Auth0). Set
these in `.env.local`:

```
CUSTOM_AUTH_ISSUER=http://127.0.0.1:3210
CUSTOM_AUTH_JWKS_URL=http://127.0.0.1:3210/.well-known/jwks.json
CUSTOM_AUTH_AUDIENCE=trade-xyz
CUSTOM_AUTH_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nREPLACE_ME\n-----END PRIVATE KEY-----
CUSTOM_AUTH_PUBLIC_JWK={"kty":"RSA","kid":"trade-xyz-dev","use":"sig","alg":"RS256","n":"REPLACE_ME","e":"AQAB"}
# Optional: override the kid used in JWT headers
# CUSTOM_AUTH_KEY_ID=trade-xyz-dev
```

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

## Notes
- Routes are handled manually via `window.history`:
  - `/trade` or `/trade/SYMBOL`
  - `/portfolio`
- The app expects network access to Binance endpoints for live data.
