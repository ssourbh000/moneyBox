# Strategy B — 45-Min ORB (Opening Range Breakout)

**Type:** Intraday options buying | **Instruments:** NIFTY 50, NIFTY BANK | **Timeframe:** 5-min

Buy an ITM Call or Put when price breaks the first 45-min opening range, confirmed by 8 filters.
No overnight positions. All trades closed by 3:00 PM IST.

---

## Session Flow

```
9:15 AM   Market opens, ORB starts forming
10:00 AM  ORB locks in (9 × 5-min bars complete)
10:00 AM – 2:30 PM  Entry window — signals checked every 5 min
3:00 PM   All open positions force-closed
```

---

## Entry — All 8 Must Pass

| # | Filter | CALL condition | PUT condition |
|---|--------|---------------|--------------|
| 1 | ORB break | close > ORB high | close < ORB low |
| 2 | Supertrend (10,3) | bullish (+1) | bearish (−1) |
| 3 | EMA 9/21 | EMA9 > EMA21 | EMA9 < EMA21 |
| 4 | VWAP | close > VWAP | close < VWAP |
| 5 | RSI (14) | RSI > 60 | RSI < 40 |
| 6 | ADX (14) | ≥ 20 (trend exists) | ≥ 20 (trend exists) |
| 7 | PDH/PDL break | close > prev day high | close < prev day low |
| 8 | Volume surge | bar volume > 1.5× 20-bar avg | same |

**Plus:** 15-min EMA9/21 must agree with 5-min direction (MTF alignment).

---

## VIX Regime Mode

No hard VIX cap. Parameters adapt to market conditions:

| Regime | VIX | RSI thresh | ADX min | Trail SL | Max trades |
|--------|-----|-----------|---------|----------|-----------|
| NORMAL | ≤ 20 | 60 / 40 | 20 | 20% | 4/day |
| HIGH | 20–28 | 55 / 45 | 25 | 25% | 4/day |
| CRISIS | > 28 | 65 / 35 | 30 | 20% | 1/day |

CRISIS also requires a gap (>0.5%) — only trades with the panic direction.

---

## Position Sizing

```
Strike     = nearest ITM strike to spot price
Premium    = Black-Scholes price (spot, strike, 7% RFR, TTE, VIX/100 as IV)
SL %       = ATR-based, clamped 25%–45% of premium
Lots       = floor(₹4,000 risk / ((entry − SL) × lot size))
```

---

## Trade Management

- **Trailing SL:** SL ratchets up as premium rises — locked at 20% below peak (25% in HIGH regime)
- **Partial exit:** At 1.8× entry premium → exit half lots, let rest run
- **20-min cooldown** between trades; gap direction locks entry side on gap days

---

## Exit Rules

| Trigger | Reason |
|---------|--------|
| Premium ≤ trailing SL | TRAIL_SL (profitable) |
| Premium ≤ initial SL | SL (max loss ₹4,000) |
| 3:00 PM IST | EOD force-close |

---

## Backtest Results (2024, NIFTY + BANKNIFTY)

| Win Rate | Net P&L | Profit Factor | Sharpe |
|----------|---------|---------------|--------|
| 83.9% | ₹7,37,616 | 40.97 | > 3.0 |

Starting capital ₹10L → ~74% ROI in 12 months.
