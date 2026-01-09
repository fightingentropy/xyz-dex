# Spec Definitions

This document defines key domain terms used by Trade XYZ.

## Portfolio Margin (Spot-Collateralized Shorts)

### Overview
Portfolio margin is a user-level mode that allows spot holdings of a given
asset to collateralize short perp positions of the same asset. The hedged
portion of the short does not require USDC/USDT margin and is treated as having
no liquidation risk for that portion.

### Core fields
- `users.portfolioMarginEnabled`: user toggle for portfolio margin mode.
- `spotBalances`: per-user spot holdings by asset symbol.
- `positions.spotCollateralSize`: the size of a perp position that is backed
  by spot holdings of the same asset.
- `positions.size`: perp position size (negative for shorts, positive for longs).
- `positions.leverage`: leverage used for the position.
- `positions.collateral`: perps collateral asset (`USDC` or `USDT`).

### Derived quantities
- `shortSize = abs(position.size)` when `position.size < 0`.
- `spotCollateralSize = portfolioMarginEnabled
  ? min(spotBalance(symbol), shortSize)
  : 0`.
- `hedgedSize = spotCollateralSize`.
- `unhedgedSize = max(0, shortSize - spotCollateralSize)`.
- `marginRequired = (unhedgedSize * markPrice) / leverage`.

### Rules
- Only short perp positions (`size < 0`) can be spot-collateralized. Longs
  always have `spotCollateralSize = 0`.
- Hedging is symbol-scoped. Spot balances only offset perp shorts for the same
  asset symbol.
- Portfolio margin is independent from cross/isolated margin type. The toggle
  applies to all perps positions for the user; margin type remains per-order.
- Spot balances are not locked. Changing a spot balance immediately updates the
  available hedge for that asset.
- When portfolio margin is disabled, all `spotCollateralSize` values are
  cleared to `0`.

### Lifecycle updates
- Toggle on/off: `recalculateSpotCollateral` recomputes (or clears) spot
  collateral across all positions for the user.
- Spot balance changes: the matching position for that asset is recalculated
  using the new balance.
- Order fills: spot collateral is recomputed for the updated position size.

### Margin checks and available balance
- Margin checks before order placement compute a `nextMarginUsed` value:
  - existing positions use their stored entry price,
  - the new or updated position uses the current mark price,
  - only the unhedged portion consumes margin.
- Available balance shown in the UI subtracts margin used across positions
  using current mark prices and unhedged sizes.

### Liquidation display (UI spec)
- Fully hedged shorts show `None` for liquidation price.
- Cross margin:
  - short liquidation: `entryPrice + equity / unhedgedSize`
  - long liquidation: `entryPrice - equity / abs(size)`
- Isolated margin:
  - short liquidation: `entryPrice * (1 + 1 / leverage)`
  - long liquidation: `entryPrice * (1 - 1 / leverage)`
- For partially hedged shorts in cross margin, only the unhedged size is used
  in the liquidation calculation.

### Examples
Partial hedge:
- Spot balance: `2 BTC`
- Short perp position: `-3 BTC` at `50,000`, `10x`
- `spotCollateralSize = min(2, 3) = 2`
- `unhedgedSize = 1`
- `marginRequired = (1 * 50,000) / 10 = 5,000`

Full hedge:
- Spot balance: `5 BTC`
- Short perp position: `-3 BTC`
- `spotCollateralSize = 3`, `unhedgedSize = 0`
- `marginRequired = 0`, liquidation shown as `None`

## Auto-Deleveraging (ADL)

### Overview
ADL (auto-deleveraging) is an automatic position-reduction mechanism triggered
when a position breaches its liquidation threshold. It runs silently (no UI
indicator) and reduces risk via a market fill.

### Rules
- Trigger condition uses the same liquidation price logic as the UI:
  - isolated: `entryPrice * (1 ± 1 / leverage)`
  - cross: `entryPrice ± equity / size` (shorts use `unhedgedSize`)
- Fully hedged shorts are exempt.
- When triggered, reduce the position size by 25% (min `0.0001`) at the current
  mark price.
- A per-symbol cooldown (4s) prevents repeated triggers on every tick.
