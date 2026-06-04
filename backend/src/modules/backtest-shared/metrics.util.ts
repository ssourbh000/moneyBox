import { mean, stdDev } from '../strategies/indicators';

interface MinTrade { netPnl: number; exitTime: string; }

export function computeMetrics(trades: MinTrade[], init: number) {
  if (!trades.length) return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, grossProfit: 0, grossLoss: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, expectancy: 0, maxDrawdown: 0, sharpeRatio: 0, roi: 0, finalCapital: init };
  const wins = trades.filter(t => t.netPnl > 0), losses = trades.filter(t => t.netPnl <= 0);
  const gp = wins.reduce((s, t) => s + t.netPnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));
  let eq = init, pk = init, dd = 0;
  for (const t of [...trades].sort((a, b) => a.exitTime.localeCompare(b.exitTime))) { eq += t.netPnl; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const dayPnl = new Map<string, number>();
  trades.forEach(t => dayPnl.set(t.exitTime.slice(0, 10), (dayPnl.get(t.exitTime.slice(0, 10)) ?? 0) + t.netPnl));
  const RFDR = 0.065 / 252; let re = init; const dr: number[] = [];
  for (const [, p] of [...dayPnl.entries()].sort()) { dr.push(p / re - RFDR); re += p; }
  const sh = dr.length > 1 ? +(mean(dr) / (stdDev(dr) || 1e-10) * Math.sqrt(252)).toFixed(2) : 0;
  return { totalTrades: trades.length, wins: wins.length, losses: losses.length, winRate: +((wins.length / trades.length) * 100).toFixed(1), netPnl: +(gp - gl).toFixed(2), grossProfit: +gp.toFixed(2), grossLoss: +gl.toFixed(2), profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : 99, avgWin: wins.length ? +(gp / wins.length).toFixed(2) : 0, avgLoss: losses.length ? +(gl / losses.length).toFixed(2) : 0, expectancy: +((gp - gl) / trades.length).toFixed(2), maxDrawdown: +dd.toFixed(2), sharpeRatio: sh, roi: +(((gp - gl) / init) * 100).toFixed(2), finalCapital: +(init + (gp - gl)).toFixed(2) };
}

export function buildVixMap(vixBars: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of vixBars) {
    m.set(b.timestamp.toISOString().slice(0, 10), b.close);
  }
  return m;
}

export function computeTradeSummary(trades: Array<{ status: string; netPnl?: number | null }>) {
  const closed    = trades.filter(t => t.status === 'CLOSED');
  const wins      = closed.filter(t => (t.netPnl ?? 0) > 0);
  const losses    = closed.filter(t => (t.netPnl ?? 0) <= 0);
  const netPnl    = closed.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const grossWin  = wins.reduce((s, t) => s + (t.netPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.netPnl ?? 0), 0));

  return {
    total:        closed.length,
    wins:         wins.length,
    losses:       losses.length,
    skipped:      trades.filter(t => t.status === 'SKIPPED').length,
    winRate:      closed.length ? Math.round((wins.length / closed.length) * 10000) / 100 : 0,
    netPnl:       Math.round(netPnl),
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : 999,
    avgWin:       wins.length   ? Math.round(grossWin / wins.length)    : 0,
    avgLoss:      losses.length ? Math.round(-grossLoss / losses.length) : 0,
  };
}
