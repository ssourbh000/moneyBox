import { OHLCV } from './indicators';

// ── Normal CDF (Abramowitz & Stegun) ──────────────────────────────────────────
function normCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.39894228 * Math.exp(-0.5 * x * x);
  const p = d * t * (0.31938153 + t * (-0.35656378 + t * (1.78147794 + t * (-1.82125978 + t * 1.33027443))));
  return x >= 0 ? 1 - p : p;
}

// ── Black-Scholes option price ────────────────────────────────────────────────
export function bsPrice(
  S: number,   // spot
  K: number,   // strike
  r: number,   // risk-free rate (annual, e.g. 0.07)
  T: number,   // time to expiry in years
  sigma: number, // annualised IV (e.g. 0.15 for 15%)
  type: 'call' | 'put',
): number {
  if (T <= 0) return Math.max(0, type === 'call' ? S - K : K - S);
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === 'call') return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

// ── ITM strike selection ──────────────────────────────────────────────────────
// Returns one strike IN-THE-MONEY from spot (better delta, lower theta risk)
export function itmStrike(spot: number, direction: 'CALL' | 'PUT', tickSize: number): number {
  const atm = Math.round(spot / tickSize) * tickSize;
  return direction === 'CALL' ? atm - tickSize : atm + tickSize;
}

// ── Session VWAP ──────────────────────────────────────────────────────────────
// Pass all bars for the current session (resets each day)
export function calcVWAP(bars: OHLCV[]): number[] {
  let cumTPV = 0;
  let cumVol = 0;
  return bars.map((b) => {
    const tp = (b.high + b.low + b.close) / 3;
    cumTPV += tp * b.volume;
    cumVol += b.volume;
    return cumVol > 0 ? cumTPV / cumVol : tp;
  });
}

// ── Supertrend ────────────────────────────────────────────────────────────────
export interface SupertrendResult {
  trend: number[];   // 1 = bullish, -1 = bearish
  upper: number[];
  lower: number[];
}

export function calcSupertrend(
  bars: OHLCV[],
  period: number,
  multiplier: number,
): SupertrendResult {
  const n = bars.length;
  const trend: number[] = new Array(n).fill(0);
  const upper: number[] = new Array(n).fill(0);
  const lower: number[] = new Array(n).fill(0);

  // ATR via Wilder smoothing
  const trs: number[] = [bars[0].high - bars[0].low];
  for (let i = 1; i < n; i++) {
    trs.push(Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close),
    ));
  }
  let atrVal = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < n; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
    const hl2 = (bars[i].high + bars[i].low) / 2;
    const basicUpper = hl2 + multiplier * atrVal;
    const basicLower = hl2 - multiplier * atrVal;

    upper[i] = (basicUpper < upper[i - 1] || bars[i - 1].close > upper[i - 1]) ? basicUpper : upper[i - 1];
    lower[i] = (basicLower > lower[i - 1] || bars[i - 1].close < lower[i - 1]) ? basicLower : lower[i - 1];

    if (i === period) {
      trend[i] = bars[i].close > upper[i] ? 1 : -1;
    } else if (trend[i - 1] === -1 && bars[i].close > upper[i - 1]) {
      trend[i] = 1;
    } else if (trend[i - 1] === 1 && bars[i].close < lower[i - 1]) {
      trend[i] = -1;
    } else {
      trend[i] = trend[i - 1];
    }
  }

  return { trend, upper, lower };
}

// ── Opening Range Breakout ────────────────────────────────────────────────────
// Takes first numBars 5-min bars of the session (default 3 = 9:15, 9:20, 9:25)
export function calcORB(sessionBars: OHLCV[], numBars = 3): { high: number; low: number } {
  const slice = sessionBars.slice(0, numBars);
  return {
    high: Math.max(...slice.map((b) => b.high)),
    low: Math.min(...slice.map((b) => b.low)),
  };
}

// ── Central Pivot Range ───────────────────────────────────────────────────────
export interface CPR {
  pivot: number;
  tc: number;   // Top of CPR
  bc: number;   // Bottom of CPR
  width: number;
  widthPct: number; // width as % of pivot (< 0.3% = narrow = trending day)
}

export function calcCPR(prevDay: OHLCV): CPR {
  const pivot = (prevDay.high + prevDay.low + prevDay.close) / 3;
  const bc = (prevDay.high + prevDay.low) / 2;
  const tc = 2 * pivot - bc;
  const width = Math.abs(tc - bc);
  return { pivot, tc, bc, width, widthPct: (width / pivot) * 100 };
}

// ── Time helpers (IST) ────────────────────────────────────────────────────────
export function istHHMM(date: Date): number {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 100 + ist.getUTCMinutes();
}

export function istDayOfWeek(date: Date): number {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCDay(); // 0=Sun, 1=Mon … 5=Fri, 6=Sat
}

// Returns true if the timestamp is a new trading day vs previous bar
export function isNewDay(prev: Date, curr: Date): boolean {
  const pIST = new Date(prev.getTime() + 5.5 * 60 * 60 * 1000);
  const cIST = new Date(curr.getTime() + 5.5 * 60 * 60 * 1000);
  return pIST.getUTCDate() !== cIST.getUTCDate() ||
    pIST.getUTCMonth() !== cIST.getUTCMonth() ||
    pIST.getUTCFullYear() !== cIST.getUTCFullYear();
}
