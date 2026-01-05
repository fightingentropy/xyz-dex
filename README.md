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

## Notes
- Routes are handled manually via `window.history`:
  - `/trade` or `/trade/SYMBOL`
  - `/portfolio`
- The app expects network access to Binance endpoints for live data.
