'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { BarChart2, Play, RefreshCw, Trophy, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import api from '@/lib/api';
import type { OBRun, OBMetrics } from '@/services/option-backtest.service';

// ── Strategy registry ─────────────────────────────────────────────────────────

const STRATEGIES = [
  {
    key:      'original',
    label:    'Original',
    subtitle: 'ORB + ST Flip · 9:30–10:30 · VIX≤18 · 1 trade/day',
    endpoint: 'option-backtest',
    color:    'border-gray-500',
    badge:    'bg-gray-700 text-gray-300',
  },
  {
    key:      'orb15',
    label:    'B — 45-min ORB',
    subtitle: '45-min range · EMA direction · 10:00–14:00 · 3/day',
    endpoint: 'orb15-backtest',
    color:    'border-purple-500',
    badge:    'bg-purple-900 text-purple-300',
  },
] as const;

type StrategyKey = typeof STRATEGIES[number]['key'];

interface RunState {
  run: OBRun | null;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getBest(rows: { key: StrategyKey; m: OBMetrics }[], field: keyof OBMetrics, higher = true): StrategyKey | null {
  if (!rows.length) return null;
  return rows.reduce((best, r) => {
    const bv = best.m[field] as number, rv = r.m[field] as number;
    return higher ? (rv > bv ? r : best) : (rv < bv ? r : best);
  }).key;
}

function fmt(v: number | undefined, prefix = '', suffix = '') {
  if (v === undefined || v === null) return '—';
  return `${prefix}${v.toLocaleString('en-IN')}${suffix}`;
}

function DeltaBadge({ base, value }: { base: number | undefined; value: number | undefined }) {
  if (base === undefined || value === undefined) return null;
  const delta = value - base;
  if (Math.abs(delta) < 0.01) return <span className="text-xs text-gray-500 ml-1">–</span>;
  const pos = delta > 0;
  return (
    <span className={`text-xs ml-1 ${pos ? 'text-green-400' : 'text-red-400'}`}>
      {pos ? <TrendingUp size={10} className="inline" /> : <TrendingDown size={10} className="inline" />}
      {pos ? '+' : ''}{delta.toFixed(1)}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
const TODAY         = new Date().toISOString().slice(0, 10);

export default function StrategyComparePage() {
  const [fromDate, setFromDate] = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]   = useState(TODAY);
  const [states,   setStates]   = useState<Record<StrategyKey, RunState>>(() =>
    Object.fromEntries(STRATEGIES.map(s => [s.key, { run: null, status: 'idle' }])) as Record<StrategyKey, RunState>
  );
  const [running,  setRunning]  = useState(false);
  const [overlayKey, setOverlayKey] = useState<StrategyKey | null>(null);

  // Load latest completed run for each strategy on mount
  useEffect(() => {
    STRATEGIES.forEach(async (s) => {
      try {
        const list = await api.get<OBRun[]>(`/${s.endpoint}/list`).then(r => r.data);
        const completed = list.find(r => r.status === 'COMPLETED');
        if (completed) {
          const full = await api.get<OBRun>(`/${s.endpoint}/${completed._id}`).then(r => r.data);
          setStates(prev => ({ ...prev, [s.key]: { run: full, status: 'completed' } }));
        }
      } catch { /* no runs yet */ }
    });
  }, []);

  const pollOne = useCallback((key: StrategyKey, runId: string, endpoint: string) => {
    const interval = setInterval(async () => {
      try {
        const updated = await api.get<OBRun>(`/${endpoint}/${runId}`).then(r => r.data);
        if (updated.status === 'COMPLETED') {
          clearInterval(interval);
          setStates(prev => ({ ...prev, [key]: { run: updated, status: 'completed' } }));
        } else if (updated.status === 'FAILED') {
          clearInterval(interval);
          setStates(prev => ({ ...prev, [key]: { run: null, status: 'failed', error: updated.errorMessage } }));
        }
      } catch { clearInterval(interval); }
    }, 5000);
  }, []);

  const handleRunAll = async () => {
    setRunning(true);
    // Mark all as queued
    setStates(prev => {
      const next = { ...prev };
      STRATEGIES.forEach(s => { next[s.key] = { ...next[s.key], status: 'queued' }; });
      return next;
    });
    // Fire all simultaneously
    await Promise.allSettled(
      STRATEGIES.map(async (s) => {
        try {
          const run = await api.post<OBRun>(`/${s.endpoint}/run`, { fromDate, toDate }).then(r => r.data);
          setStates(prev => ({ ...prev, [s.key]: { run, status: 'running' } }));
          pollOne(s.key, run._id, s.endpoint);
        } catch (e: any) {
          setStates(prev => ({ ...prev, [s.key]: { run: null, status: 'failed', error: e.message } }));
        }
      })
    );
    setRunning(false);
  };

  // All completed?
  const completedCount = STRATEGIES.filter(s => states[s.key].status === 'completed').length;
  const allDone = completedCount === STRATEGIES.length;

  // Build comparison rows
  const completedRows = STRATEGIES
    .filter(s => states[s.key].run?.metrics)
    .map(s => ({ key: s.key, m: states[s.key].run!.metrics as OBMetrics }));

  const baseMetrics = completedRows.find(r => r.key === 'original')?.m;

  // Best-in-class per column
  const bestTrades  = getBest(completedRows, 'totalTrades', true);
  const bestWR      = getBest(completedRows, 'winRate', true);
  const bestPnl     = getBest(completedRows, 'netPnl', true);
  const bestPF      = getBest(completedRows, 'profitFactor', true);
  const bestSharpe  = getBest(completedRows, 'sharpeRatio', true);
  const bestDD      = getBest(completedRows, 'maxDrawdown', false); // lower is better
  const bestROI     = getBest(completedRows, 'roi', true);

  // Score: weighted composite (trades 15%, WR 25%, PF 20%, Sharpe 20%, ROI 15%, DD-5%)
  const scores = completedRows.map(r => {
    const m = r.m;
    const maxT = Math.max(...completedRows.map(x => x.m.totalTrades));
    const maxPnl = Math.max(...completedRows.map(x => x.m.netPnl));
    const maxDD = Math.max(...completedRows.map(x => x.m.maxDrawdown));
    const tScore    = maxT > 0 ? (m.totalTrades / maxT) * 15 : 0;
    const wrScore   = m.winRate * 0.25;
    const pfScore   = Math.min(m.profitFactor / 3, 1) * 20;
    const shScore   = Math.min(Math.max(m.sharpeRatio, 0) / 3, 1) * 20;
    const roiScore  = Math.min(Math.max(m.roi, 0) / 200, 1) * 15;
    const ddScore   = maxDD > 0 ? (1 - m.maxDrawdown / maxDD) * 5 : 5;
    return { key: r.key, score: +(tScore + wrScore + pfScore + shScore + roiScore + ddScore).toFixed(1) };
  });
  const topScore = scores.reduce((b, s) => s.score > b.score ? s : b, { key: 'original' as StrategyKey, score: -Infinity });

  const overlayEquity = overlayKey
    ? states[overlayKey].run?.metrics?.equityCurve
    : null;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart2 size={24} className="text-indigo-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Strategy Comparison</h1>
            <p className="text-sm text-gray-400">Run all 6 strategies on the same data — pick the winner</p>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
          </div>
          <button
            onClick={handleRunAll}
            disabled={running}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded text-sm font-semibold"
          >
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? 'Running…' : 'Run Both Strategies'}
          </button>
          {completedCount > 0 && (
            <span className="text-sm text-gray-400 self-center">{completedCount} / {STRATEGIES.length} completed</span>
          )}
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STRATEGIES.map(s => {
            const st = states[s.key];
            const statusColor = st.status === 'completed' ? 'text-green-400' : st.status === 'running' ? 'text-yellow-400' : st.status === 'failed' ? 'text-red-400' : 'text-gray-500';
            const isWinner = topScore.key === s.key && allDone;
            return (
              <div key={s.key} className={`bg-gray-800 rounded-lg p-3 border-l-4 ${s.color} ${isWinner ? 'ring-2 ring-yellow-400' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${s.badge}`}>{s.label}</span>
                  {isWinner && <Trophy size={14} className="text-yellow-400" />}
                </div>
                <p className="text-xs text-gray-400 mt-1">{s.subtitle}</p>
                <div className={`text-xs mt-2 font-medium ${statusColor}`}>
                  {st.status === 'running' && <span className="flex items-center gap-1"><RefreshCw size={10} className="animate-spin" /> Running…</span>}
                  {st.status === 'queued' && 'Queued…'}
                  {st.status === 'idle' && 'Not run yet'}
                  {st.status === 'failed' && `Failed: ${st.error?.slice(0, 30)}`}
                  {st.status === 'completed' && st.run?.metrics && (
                    <span className={st.run.metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                      ₹{st.run.metrics.netPnl.toLocaleString()} · {st.run.metrics.totalTrades}T · {st.run.metrics.winRate}%WR
                    </span>
                  )}
                </div>
                {scores.find(sc => sc.key === s.key) && (
                  <div className="text-xs text-indigo-400 mt-0.5">Score: {scores.find(sc => sc.key === s.key)!.score}</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Comparison table */}
        {completedRows.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Side-by-Side Metrics
              <span className="text-xs text-gray-500 ml-2">(delta vs Original in brackets)</span>
            </h2>
            <table className="w-full text-sm text-left min-w-[900px]">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="py-2 px-3 w-36">Metric</th>
                  {STRATEGIES.map(s => (
                    <th key={s.key} className={`py-2 px-3 ${topScore.key === s.key && allDone ? 'text-yellow-300' : 'text-gray-400'}`}>
                      {s.label}
                      {topScore.key === s.key && allDone && <Trophy size={10} className="inline ml-1 text-yellow-400" />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Total Trades',   field: 'totalTrades'  as keyof OBMetrics, best: bestTrades,  fmt: (v: number) => v.toString(),           higher: true  },
                  { label: 'Win Rate',       field: 'winRate'      as keyof OBMetrics, best: bestWR,      fmt: (v: number) => `${v}%`,                higher: true  },
                  { label: 'Net P&L',        field: 'netPnl'       as keyof OBMetrics, best: bestPnl,     fmt: (v: number) => `₹${v.toLocaleString()}`,higher: true  },
                  { label: 'ROI',            field: 'roi'          as keyof OBMetrics, best: bestROI,     fmt: (v: number) => `${v}%`,                higher: true  },
                  { label: 'Profit Factor',  field: 'profitFactor' as keyof OBMetrics, best: bestPF,      fmt: (v: number) => v.toFixed(2),           higher: true  },
                  { label: 'Sharpe Ratio',   field: 'sharpeRatio'  as keyof OBMetrics, best: bestSharpe,  fmt: (v: number) => v.toFixed(2),           higher: true  },
                  { label: 'Max Drawdown',   field: 'maxDrawdown'  as keyof OBMetrics, best: bestDD,      fmt: (v: number) => `₹${v.toLocaleString()}`,higher: false },
                  { label: 'Avg Win',        field: 'avgWin'       as keyof OBMetrics, best: null,        fmt: (v: number) => `₹${v.toLocaleString()}`,higher: true  },
                  { label: 'Avg Loss',       field: 'avgLoss'      as keyof OBMetrics, best: null,        fmt: (v: number) => `₹${v.toLocaleString()}`,higher: false },
                  { label: 'Expectancy',     field: 'expectancy'   as keyof OBMetrics, best: null,        fmt: (v: number) => `₹${v.toLocaleString()}`,higher: true  },
                  { label: 'Final Capital',  field: 'finalCapital' as keyof OBMetrics, best: null,        fmt: (v: number) => `₹${v.toLocaleString()}`,higher: true  },
                ].map(row => (
                  <tr key={row.field} className="border-b border-gray-700">
                    <td className="py-2 px-3 text-xs text-gray-400 font-medium">{row.label}</td>
                    {STRATEGIES.map(s => {
                      const m = states[s.key].run?.metrics as OBMetrics | undefined;
                      const val = m?.[row.field] as number | undefined;
                      const isTop = row.best === s.key;
                      return (
                        <td key={s.key} className={`py-2 px-3 text-sm ${isTop ? 'text-green-300 font-bold' : 'text-white'}`}>
                          {val !== undefined ? row.fmt(val) : <span className="text-gray-600">—</span>}
                          {s.key !== 'original' && val !== undefined && baseMetrics?.[row.field] !== undefined && (
                            <DeltaBadge base={baseMetrics[row.field] as number} value={val} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Composite score bar */}
        {scores.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Composite Score
              <span className="text-xs text-gray-500 ml-2">trades 15% + WR 25% + PF 20% + Sharpe 20% + ROI 15% + DD-5%</span>
            </h2>
            <div className="space-y-2">
              {[...scores].sort((a, b) => b.score - a.score).map((sc, rank) => {
                const s = STRATEGIES.find(x => x.key === sc.key)!;
                const maxScore = Math.max(...scores.map(x => x.score));
                const pct = maxScore > 0 ? (sc.score / maxScore) * 100 : 0;
                return (
                  <div key={sc.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-5 text-right">{rank + 1}.</span>
                    <span className={`text-xs px-2 py-0.5 rounded w-40 ${s.badge}`}>{s.label}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-4 relative">
                      <div className="bg-indigo-500 h-4 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-bold text-white w-12 text-right">{sc.score}</span>
                    {rank === 0 && <Trophy size={14} className="text-yellow-400" />}
                    {rank > 0 && <Minus size={14} className="text-gray-600" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Equity curve detail view */}
        {completedRows.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-300">Equity Curve</h2>
              <div className="flex gap-2">
                {STRATEGIES.filter(s => states[s.key].run?.metrics?.equityCurve?.length).map(s => (
                  <button
                    key={s.key}
                    onClick={() => setOverlayKey(overlayKey === s.key ? null : s.key)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${overlayKey === s.key ? s.badge : 'bg-gray-700 text-gray-400'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {overlayEquity && overlayKey ? (
              <EquityChart data={overlayEquity} initialCapital={1_000_000} />
            ) : (
              <p className="text-xs text-gray-500 py-8 text-center">Click a strategy above to view its equity curve</p>
            )}
          </div>
        )}

        {/* Winner recommendation */}
        {allDone && topScore.key !== 'original' && (
          <div className="bg-gray-800 border border-yellow-500 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Trophy size={18} className="text-yellow-400" />
              <h2 className="text-sm font-bold text-yellow-300">Recommended Strategy</h2>
            </div>
            <p className="text-sm text-gray-300">
              <b className="text-white">{STRATEGIES.find(s => s.key === topScore.key)!.label}</b> scored highest at <b className="text-yellow-400">{topScore.score} points</b> — best composite of trade count, win rate, profit factor, Sharpe, and ROI.
            </p>
            <p className="text-xs text-gray-500 mt-1">{STRATEGIES.find(s => s.key === topScore.key)!.subtitle}</p>
          </div>
        )}

      </div>
    </AppShell>
  );
}
