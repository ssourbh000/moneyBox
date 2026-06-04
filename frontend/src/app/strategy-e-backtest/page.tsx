'use client';

import { useState, useCallback } from 'react';
import api from '@/lib/api';
import EquityChart from '@/components/charts/EquityChart';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SEBTrade {
  date: string;
  strategy: 'C1' | 'C2' | 'E' | 'PS';
  leg: 'MORNING' | 'AFTERNOON';
  tradeType: string;
  direction?: string;
  entryTime: string;
  exitTime: string;
  entryPremium: number;
  exitPremium: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: string;
  vix: number;
  meta: Record<string, number | string>;
}

interface SEBMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  avgTradesPerDay: number;
  roi: number;
  finalCapital: number;
  equityCurve: { t: string; e: number }[];
}

interface SEBResult {
  label: string;
  description: string;
  trades: SEBTrade[];
  metrics: SEBMetrics;
}

interface RunResult {
  c1: SEBResult;
  c2: SEBResult;
  e: SEBResult;
  ps: SEBResult;
}

const STRATEGY_KEYS: (keyof RunResult)[] = ['c1', 'c2', 'e', 'ps'];
const STRATEGY_COLORS: Record<string, string> = {
  c1: 'blue', c2: 'green', e: 'purple', ps: 'orange',
};

// ── Metric Card ────────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-zinc-800 rounded-lg p-3 flex flex-col gap-0.5">
      <p className="text-zinc-400 text-xs">{label}</p>
      <p className="text-white text-lg font-bold">{value}</p>
      {sub && <p className="text-zinc-500 text-xs">{sub}</p>}
    </div>
  );
}

// ── Strategy Panel ─────────────────────────────────────────────────────────────

function StrategyPanel({ result, color }: { result: SEBResult; color: string }) {
  const [showTrades, setShowTrades] = useState(false);
  const m = result.metrics;

  const borderColor: Record<string, string> = {
    blue: 'border-blue-500', green: 'border-green-500',
    purple: 'border-purple-500', orange: 'border-orange-500',
  };
  const textColor: Record<string, string> = {
    blue: 'text-blue-400', green: 'text-green-400',
    purple: 'text-purple-400', orange: 'text-orange-400',
  };
  const bgColor: Record<string, string> = {
    blue: 'bg-blue-500/10', green: 'bg-green-500/10',
    purple: 'bg-purple-500/10', orange: 'bg-orange-500/10',
  };

  return (
    <div className={`bg-zinc-900 rounded-xl border-l-4 ${borderColor[color]} p-5 flex flex-col gap-4`}>
      {/* Header */}
      <div>
        <h3 className={`font-bold text-lg ${textColor[color]}`}>{result.label}</h3>
        <p className="text-zinc-400 text-sm mt-1">{result.description}</p>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="Net P&L" value={`₹${m.netPnl.toLocaleString()}`} />
        <MetricCard label="Win Rate" value={`${m.winRate}%`} sub={`${m.wins}W / ${m.losses}L`} />
        <MetricCard label="Trades" value={m.totalTrades} sub={`${m.avgTradesPerDay}/day avg`} />
        <MetricCard label="Profit Factor" value={m.profitFactor} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard label="ROI" value={`${m.roi}%`} />
        <MetricCard label="Max Drawdown" value={`${m.maxDrawdown}%`} />
        <MetricCard label="Avg Win" value={`₹${m.avgWin.toLocaleString()}`} />
        <MetricCard label="Avg Loss" value={`₹${m.avgLoss.toLocaleString()}`} />
      </div>

      {/* Equity curve */}
      {m.equityCurve.length > 1 && (
        <div className="h-36">
          <EquityChart data={m.equityCurve} initialCapital={100_000} />
        </div>
      )}

      {/* Exit reason breakdown */}
      <ExitBreakdown trades={result.trades} bgColor={bgColor[color]} textColor={textColor[color]} />

      {/* Trade log toggle */}
      <button
        onClick={() => setShowTrades(v => !v)}
        className={`text-sm ${textColor[color]} underline text-left`}
      >
        {showTrades ? 'Hide' : 'Show'} trade log ({result.trades.length} trades)
      </button>
      {showTrades && <TradeLog trades={result.trades} />}
    </div>
  );
}

function ExitBreakdown({ trades, bgColor, textColor }: { trades: SEBTrade[]; bgColor: string; textColor: string }) {
  const counts = trades.reduce((acc, t) => {
    acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (Object.keys(counts).length === 0) return null;

  return (
    <div className={`${bgColor} rounded-lg p-3`}>
      <p className={`text-xs font-semibold ${textColor} mb-2`}>Exit Breakdown</p>
      <div className="flex flex-wrap gap-3">
        {Object.entries(counts).map(([reason, count]) => (
          <div key={reason} className="text-xs text-zinc-300">
            <span className="font-mono font-bold">{reason}</span>
            <span className="text-zinc-500 ml-1">× {count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TradeLog({ trades }: { trades: SEBTrade[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-zinc-300 border-collapse">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-700">
            <th className="py-1 pr-3 text-left">Date</th>
            <th className="py-1 pr-3 text-left">Leg</th>
            <th className="py-1 pr-3 text-left">Dir</th>
            <th className="py-1 pr-3 text-right">Entry ₹</th>
            <th className="py-1 pr-3 text-right">Exit ₹</th>
            <th className="py-1 pr-3 text-right">Net P&L</th>
            <th className="py-1 pr-3 text-left">Exit</th>
            <th className="py-1 pr-3 text-right">VIX</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/50">
              <td className="py-1 pr-3 font-mono">{t.date}</td>
              <td className="py-1 pr-3">{t.leg}</td>
              <td className="py-1 pr-3">
                <span className={`px-1 rounded text-xs ${
                  t.direction === 'CALL' ? 'bg-green-800 text-green-300' :
                  t.direction === 'PUT' ? 'bg-red-800 text-red-300' :
                  'bg-zinc-700 text-zinc-300'
                }`}>
                  {t.direction ?? '-'}
                </span>
              </td>
              <td className="py-1 pr-3 text-right font-mono">{t.entryPremium}</td>
              <td className="py-1 pr-3 text-right font-mono">{t.exitPremium}</td>
              <td className={`py-1 pr-3 text-right font-mono font-bold ${t.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {t.netPnl >= 0 ? '+' : ''}{t.netPnl.toLocaleString()}
              </td>
              <td className="py-1 pr-3">
                <span className={`px-1 rounded text-xs ${
                  t.exitReason === 'TP' ? 'bg-green-900 text-green-300' :
                  t.exitReason === 'SL' ? 'bg-red-900 text-red-300' :
                  'bg-zinc-700 text-zinc-400'
                }`}>
                  {t.exitReason}
                </span>
              </td>
              <td className="py-1 pr-3 text-right">{t.vix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Comparison Summary ─────────────────────────────────────────────────────────

function ComparisonTable({ result }: { result: RunResult }) {
  const rows = STRATEGY_KEYS.map(k => ({ key: k, ...result[k].metrics, label: result[k].label }));
  const best = (field: keyof SEBMetrics, higher = true) => {
    const vals = rows.map(r => r[field] as number);
    const target = higher ? Math.max(...vals) : Math.min(...vals);
    return target;
  };

  return (
    <div className="bg-zinc-900 rounded-xl p-5 overflow-x-auto">
      <h3 className="text-white font-bold mb-3">Strategy Comparison</h3>
      <table className="w-full text-sm text-zinc-300 border-collapse">
        <thead>
          <tr className="text-zinc-500 border-b border-zinc-700">
            <th className="py-2 pr-4 text-left">Strategy</th>
            <th className="py-2 pr-4 text-right">Net P&L</th>
            <th className="py-2 pr-4 text-right">Win Rate</th>
            <th className="py-2 pr-4 text-right">Trades</th>
            <th className="py-2 pr-4 text-right">Per Day</th>
            <th className="py-2 pr-4 text-right">Prof. Factor</th>
            <th className="py-2 pr-4 text-right">Max DD</th>
            <th className="py-2 pr-4 text-right">ROI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const color = STRATEGY_COLORS[r.key];
            const colorText: Record<string, string> = {
              blue: 'text-blue-400', green: 'text-green-400',
              purple: 'text-purple-400', orange: 'text-orange-400',
            };
            return (
              <tr key={r.key} className="border-b border-zinc-800">
                <td className={`py-2 pr-4 font-semibold ${colorText[color]}`}>{r.label}</td>
                <td className={`py-2 pr-4 text-right font-mono font-bold ${r.netPnl === best('netPnl') ? 'text-yellow-300' : r.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ₹{r.netPnl.toLocaleString()}
                </td>
                <td className={`py-2 pr-4 text-right ${r.winRate === best('winRate') ? 'text-yellow-300 font-bold' : ''}`}>
                  {r.winRate}%
                </td>
                <td className="py-2 pr-4 text-right">{r.totalTrades}</td>
                <td className={`py-2 pr-4 text-right ${r.avgTradesPerDay === best('avgTradesPerDay') ? 'text-yellow-300 font-bold' : ''}`}>
                  {r.avgTradesPerDay}
                </td>
                <td className={`py-2 pr-4 text-right ${r.profitFactor === best('profitFactor') ? 'text-yellow-300 font-bold' : ''}`}>
                  {r.profitFactor}
                </td>
                <td className={`py-2 pr-4 text-right ${r.maxDrawdown === best('maxDrawdown', false) ? 'text-yellow-300 font-bold' : ''}`}>
                  {r.maxDrawdown}%
                </td>
                <td className={`py-2 pr-4 text-right font-bold ${r.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {r.roi}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-zinc-600 text-xs mt-2">Yellow = best in column</p>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function StrategyEBacktestPage() {
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-12-31');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<keyof RunResult>('c1');

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<RunResult>('/strategy-e-backtest/run', { fromDate, toDate });
      setResult(res.data);
      setActiveTab('c1');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e.message ?? 'Failed');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-7xl mx-auto flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Strategy E Backtest — Intraday Alpha</h1>
          <p className="text-zinc-400 mt-1 text-sm">
            4 strategies backtested on NIFTY 50 with Black-Scholes option pricing. 1–2 trades per day, all market conditions.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-zinc-900 rounded-xl p-5 flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">From Date</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-zinc-800 text-white rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-zinc-400 text-xs">To Date</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="bg-zinc-800 text-white rounded-lg px-3 py-2 text-sm border border-zinc-700 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <button
            onClick={run}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 text-white font-semibold px-6 py-2 rounded-lg transition-colors"
          >
            {loading ? 'Running all 4 strategies…' : 'Run Backtest'}
          </button>
          {loading && (
            <p className="text-zinc-500 text-sm">Computing Black-Scholes pricing across all trades — takes ~15s for 1 year…</p>
          )}
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">{error}</div>
        )}

        {result && (
          <>
            {/* Comparison table */}
            <ComparisonTable result={result} />

            {/* Tab selector */}
            <div className="flex gap-2 flex-wrap">
              {STRATEGY_KEYS.map(k => {
                const colorBg: Record<string, string> = {
                  blue: 'bg-blue-600', green: 'bg-green-600',
                  purple: 'bg-purple-600', orange: 'bg-orange-600',
                };
                const colorBorder: Record<string, string> = {
                  blue: 'border-blue-500', green: 'border-green-500',
                  purple: 'border-purple-500', orange: 'border-orange-500',
                };
                const col = STRATEGY_COLORS[k];
                return (
                  <button
                    key={k}
                    onClick={() => setActiveTab(k)}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                      activeTab === k
                        ? `${colorBg[col]} text-white border-transparent`
                        : `bg-transparent text-zinc-400 ${colorBorder[col]} hover:text-white`
                    }`}
                  >
                    {result[k].label.split(':')[0]}
                  </button>
                );
              })}
            </div>

            {/* Active strategy detail */}
            <StrategyPanel result={result[activeTab]} color={STRATEGY_COLORS[activeTab]} />
          </>
        )}
      </div>
    </div>
  );
}
