# Spec Definitions

This document defines key domain terms used by Trade XYZ.

## Portfolio Margin (Cross-Asset Collateral)

### Overview
Portfolio margin is a user-level mode that adds weighted spot holdings to a
shared collateral pool for all perp positions. When enabled, any spot asset can
collateralize any perp position, subject to per-asset haircuts.

### Core fields
- `users.portfolioMarginEnabled`: user toggle for portfolio margin mode.
- `spotBalances`: per-user spot holdings by asset symbol.
- `perpsBalances`: perps balances by asset (`USDC`, `USDT`).
- `positions.size`: perp position size (negative for shorts, positive for longs).
- `positions.leverage`: leverage used for the position.
- `positions.collateral`: perps collateral asset (`USDC` or `USDT`).
- `COLLATERAL_WEIGHTS`: per-asset collateral haircuts for spot assets.

### Derived quantities
- `weightedSpotEquity = Σ (spotBalance[asset] * spotPrice[asset] * weight[asset])`.
- `totalUnrealizedPnl = Σ ((markPrice - entryPrice) * size)` across all perps.
- `totalCollateralPool = perpsBalance(USDC/USDT) + weightedSpotEquity + totalUnrealizedPnl`
  (spot equity contributes only when portfolio margin is enabled).
- `marginUsed = Σ (abs(size) * markPrice / leverage)` across all perps.
- `positionMarginUsed = abs(size) * markPrice / leverage`.
- `otherMarginUsed = marginUsed - positionMarginUsed`.
- `crossEquityForPosition = totalCollateralPool - currentUnrealizedPnl - otherMarginUsed`.

### Rules
- Spot balances only contribute when portfolio margin is enabled.
- No symbol-scoped hedging; spot collateral is pooled across assets.
- Collateral weights (haircuts) apply per spot asset.
- Portfolio margin is independent from cross/isolated margin type. The toggle
  applies to all perps positions for the user; margin type remains per-order.
- Spot balances are not locked. Changing a spot balance immediately updates the
  collateral pool.

### Lifecycle updates
- Toggle on/off: clear any legacy `spotCollateralSize` fields on positions.
- Spot balance changes: the collateral pool updates immediately.
- Order fills: positions update; realized PnL is applied to perps balances.

### Margin checks and available balance
- Margin checks before order placement compare `nextMarginUsed` to the current
  `totalCollateralPool` when portfolio margin is enabled.
- Classic mode uses perps balances only (spot excluded).
- Backend checks may use demo prices as mark-price fallbacks when live prices
  are unavailable.

### Liquidation display (UI spec)
- Cross margin:
  - short liquidation: `entryPrice + equity / abs(size)`
  - long liquidation: `entryPrice - equity / abs(size)`
  - `equity = totalCollateralPool - currentUnrealizedPnl - otherMarginUsed`
- Isolated margin:
  - short liquidation: `entryPrice * (1 + 1 / leverage)`
  - long liquidation: `entryPrice * (1 - 1 / leverage)`

### Example
Cross-asset collateral:
- Perps balances: `10,000 USDC`
- Spot balances: `1 BTC`, `10 ETH`
- Weights: `BTC 0.95`, `ETH 0.9`
- Weighted spot equity (at `BTC=50,000`, `ETH=2,500`):
  - `1 * 50,000 * 0.95 + 10 * 2,500 * 0.9 = 47,500 + 22,500 = 70,000`
- Total unrealized PnL: `+2,000`
- `totalCollateralPool = 10,000 + 70,000 + 2,000 = 82,000`

## Auto-Deleveraging (ADL)

### Overview
ADL (auto-deleveraging) is an automatic position-reduction mechanism triggered
when a position breaches its liquidation threshold. It runs silently (no UI
indicator) and reduces risk via a market fill.

### Rules
- Trigger condition uses the same liquidation price logic as the UI:
  - isolated: `entryPrice * (1 ± 1 / leverage)`
  - cross: `entryPrice ± equity / abs(size)`
- Equity uses the pooled collateral model when portfolio margin is enabled.
- When triggered, reduce the position size by 25% (min `0.0001`) at the current
  mark price.
- A per-symbol cooldown (4s) prevents repeated triggers on every tick.

## Vaults (Pooled Share Accounts)

### Overview
Vaults are pooled accounts with NAV-based share pricing. Members deposit USDC,
receive vault shares, and can withdraw by redeeming shares. Vaults are not
copy-trading accounts; they track pooled equity and a single share price.

### Core fields
- `vaults`: vault metadata (`name`, `operatorUserId`, `totalShares`, `status`).
- `vaultMembers`: per-user ownership (`shares`, `costBasisUSDC`).
- `vaultMetrics`: vault equity + PnL snapshots (`equityUSDC`, `pnl`).
- `vaultFees`: performance fee ledger entries (`amountUSDC`).

### Share accounting
- `sharePrice = equityUSDC / totalShares`.
- If `totalShares == 0`, `sharePrice = 1`.
- Equity is derived from vault-owned balances (perps + spot valuation).

### Deposit (USDC only)
- Minted shares: `shares = depositAmount / sharePrice`.
- Member updates:
  - `shares += mintedShares`
  - `costBasisUSDC += depositAmount`
- Vault updates:
  - `totalShares += mintedShares`

### Withdrawal (performance fee charged at exit)
- `value = shares * sharePrice`
- `costBasisPortion = member.costBasisUSDC * (shares / memberSharesBefore)`
- `profit = max(0, value - costBasisPortion)`
- `fee = profit * 0.10`
- `payout = value - fee`
- Burn shares and reduce member cost basis by `costBasisPortion`.
- Record fee owed to the operator in `vaultFees`.
