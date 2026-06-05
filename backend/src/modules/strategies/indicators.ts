export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [seed];
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

export function rsi(closes: number[], period: number): number[] {
  if (closes.length < period + 1) return [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [];
  result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-10)));
  }
  return result;
}

function trueRanges(candles: OHLCV[]): number[] {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }
  return trs;
}

export function atr(candles: OHLCV[], period: number): number[] {
  if (candles.length < period + 1) return [];
  const trs = trueRanges(candles);
  let prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [prev];
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    result.push(prev);
  }
  return result;
}

export function adx(candles: OHLCV[], period: number): number {
  return adxSeries(candles, period).at(-1) ?? 0;
}

export function volumeRatio(volumes: number[], period: number): number {
  if (volumes.length < period + 1) return 0;
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? volumes[volumes.length - 1] / avg : 0;
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1];
}

export function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // 9:15 AM IST = 3:45 AM UTC = 225 min; 3:30 PM IST = 10:00 AM UTC = 600 min
  return mins >= 225 && mins <= 600;
}

export function isStale(timestamp: Date, thresholdMinutes: number): boolean {
  return Date.now() - timestamp.getTime() > thresholdMinutes * 60 * 1000;
}

/**
 * Returns the full ADX series. adxSeries(candles, period)[k] = ADX at candles[2*period + k].
 * Minimum candles needed = 2*period + 1.
 */
export function adxSeries(candles: OHLCV[], period: number): number[] {
  if (candles.length < 2 * period + 1) return [];
  const pdms: number[] = [];
  const ndms: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const dn = candles[i - 1].low - candles[i].low;
    pdms.push(up > dn && up > 0 ? up : 0);
    ndms.push(dn > up && dn > 0 ? dn : 0);
    trs.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close),
      ),
    );
  }
  let spdm = pdms.slice(0, period).reduce((a, b) => a + b, 0);
  let sndm = ndms.slice(0, period).reduce((a, b) => a + b, 0);
  let str = trs.slice(0, period).reduce((a, b) => a + b, 0);
  const dxValues: number[] = [];
  for (let i = period; i < pdms.length; i++) {
    spdm = spdm - spdm / period + pdms[i];
    sndm = sndm - sndm / period + ndms[i];
    str = str - str / period + trs[i];
    const pdi = (100 * spdm) / (str || 1e-10);
    const ndi = (100 * sndm) / (str || 1e-10);
    dxValues.push((100 * Math.abs(pdi - ndi)) / (pdi + ndi || 1e-10));
  }
  if (dxValues.length < period) return [];
  let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: number[] = [adxVal];
  for (let i = period; i < dxValues.length; i++) {
    adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
    result.push(adxVal);
  }
  return result;
}

/** Binary upper-bound: returns first index where arr[i] > target. */
function upperBound(arr: number[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}
