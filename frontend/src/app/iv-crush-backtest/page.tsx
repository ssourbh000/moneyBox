'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { Zap, Play, RefreshCw } from 'lucide-react';
import api from '@/lib/api';
import MetricCard from '@/components/ui/MetricCard';
import RunStatusBadge from '@/components/ui/RunStatusBadge';
import { TWO_YEARS_AGO, TODAY } from '@/lib/dates';

// Minimum capital for B (First Light Fade) — option SELL, NIFTY 1 lot = 65 qty
// SPAN + Exposure margin for 1 lot ATM straddle ≈ ₹2–2.5L depending on VIX
const MIN_CAPITAL = 250_000;

const CAPITAL_OPTIONS = [
  { label: '₹20k',   value: 20_000 },
  { label: '₹50k',   value: 50_000 },
  { label: '₹1L',    value: 100_000 },
  { label: '₹2.5L',  value: 250_000 },
  { label: '₹5L',    value: 500_000 },
  { label: 'Custom', value: -1 },
];

interface IVCTrade {
  date: string;
  spot: number;
  strike: number;
  entryStraddle: number;
  exitStraddle: number;
  lots: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'TIME';
  vix: number;
  gapPct: number;
}

interface IVCMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  roi: number;
  finalCapital: number;
  equityCurve: { t: string; e: number }[];
}

interface BacktestResult {
  trades: IVCTrade[];
  metrics: IVCMetrics;
}

interface PastRun {
  fromDate: string;
  toDate: string;
  initialCapital: number;
  result: BacktestResult;
}

const REASON_COLOR: Record<string, string> = {
  TP:   'text-green-400',
  SL:   'text-red-400',
  TIME: 'text-gray-400',
};

function TradeRow({ t }: { t: IVCTrade }) {
  const win       = t.netPnl > 0;
  const straddleChg = (((t.exitStraddle - t.entryStraddle) / t.entryStraddle) * 100).toFixed(1);
  return (
    <tr className="border-b border-gray-700 hover:bg-gray-750">
      <td className="py-2 px-3 text-sm text-gray-300">{t.date}</td>
      <td className="py-2 px-3 text-sm text-gray-300">₹{t.entryStraddle.toFixed(1)}</td>
      <td className="py-2 px-3 text-sm text-gray-300">
        ₹{t.exitStraddle.toFixed(1)}
        <span className={`ml-1 text-xs ${parseFloat(straddleChg) >= 0 ? 'text-red-500' : 'text-green-500'}`}>
          ({straddleChg}%)
        </span>
      </td>
      <td className="py-2 px-3 text-sm text-gray-400">{t.vix.toFixed(1)}</td>
      <td className="py-2 px-3 text-sm text-gray-400">{t.gapPct.toFixed(2)}%</td>
      <td className="py-2 px-3 text-sm text-gray-400">{t.lots}</td>
      <td className={`py-2 px-3 text-sm font-medium ${win ? 'text-green-400' : 'text-red-400'}`}>
        {win ? '+' : ''}₹{t.netPnl.toLocaleString()}
      </td>
      <td className={`py-2 px-3 text-xs font-medium ${REASON_COLOR[t.exitReason] ?? 'text-gray-400'}`}>
        {t.exitReason}
      </td>
    </tr>
  );
}

export default function IVCrushBacktestPage() {
  const [fromDate,       setFromDate]       = useState(TWO_YEARS_AGO);
  const [toDate,         setToDate]         = useState(TODAY);
  const [capitalOption,  setCapitalOption]  = useState(100_000);
  const [customCapital,  setCustomCapital]  = useState('');
  const [loading,        setLoading]        = useState(false);
  const [status,         setStatus]         = useState('');
  const [result,         setResult]         = useState<BacktestResult | null>(null);
  const [pastRuns,       setPastRuns]       = useState<PastRun[]>([]);
  const [selectedRun,    setSelectedRun]    = useState<PastRun | null>(null);

  const effectiveCapital =
    capitalOption === -1
      ? parseInt(customCapital, 10) || 100_000
      : capitalOption;

  const belowMinCapital = effectiveCapital < MIN_CAPITAL;

  const handleRun = async () => {
    setLoading(true);
    setStatus('Running backtest…');
    setResult(null);
    setSelectedRun(null);
    try {
      const { data } = await api.post<BacktestResult>('/iv-crush/backtest/run', {
        fromDate,
        toDate,
        initialCapital: effectiveCapital,
      });
      setResult(data);
      const run: PastRun = { fromDate, toDate, initialCapital: effectiveCapital, result: data };
      setPastRuns(prev => [run, ...prev.slice(0, 9)]);
      setStatus(`Done — ${data.metrics.totalTrades} trades`);
    } catch (e: any) {
      setStatus(`Error: ${e.response?.data?.message ?? e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const display = selectedRun ? selectedRun.result : result;
  const m       = display?.metrics;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Zap size={24} className="text-blue-400" />
          <div>
            <h1 className="text-xl font-bold text-white">B — First Light Fade</h1>
            <p className="text-sm text-gray-400">
              First Light Fade · Sell ATM straddle at 9:20 AM · NIFTY 50
            </p>
          </div>
        </div>

        {/* Strategy badges */}
        <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap gap-3 text-xs">
          <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded">Sell ATM straddle</span>
          <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded">9:20 AM entry</span>
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded">Exit by 10:00 AM</span>
          <span className="bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">Gap filter 0.8%</span>
          <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded">TP 15%</span>
          <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded">SL 100%</span>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Capital</label>
              <select
                value={capitalOption}
                onChange={(e) => setCapitalOption(Number(e.target.value))}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600"
              >
                {CAPITAL_OPTIONS.map(o => (
                  <option key={o.label} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            {capitalOption === -1 && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Custom ₹</label>
                <input
                  type="number"
                  value={customCapital}
                  onChange={(e) => setCustomCapital(e.target.value)}
                  placeholder="e.g. 250000"
                  className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 w-32"
                />
              </div>
            )}
            <button
              onClick={handleRun}
              disabled={loading || belowMinCapital}
              className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? 'Running…' : 'Run Backtest'}
            </button>
          </div>
          {belowMinCapital && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5">
              <span className="text-red-400 text-lg">⚠</span>
              <div>
                <p className="text-red-400 text-sm font-medium">
                  Minimum ₹{MIN_CAPITAL.toLocaleString('en-IN')} required for this strategy
                </p>
                <p className="text-red-400/70 text-xs mt-0.5">
                  B — First Light Fade sells an ATM straddle (option sell). SPAN + Exposure margin
                  for 1 lot NIFTY (65 qty) is ~₹2–2.5L. Selected capital is insufficient.
                </p>
              </div>
            </div>
          )}
          {status && !belowMinCapital && <p className="text-sm text-gray-400">{status}</p>}
        </div>

        {/* Results */}
        {m && display && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <MetricCard label="Total Trades"  value={m.totalTrades} />
              <MetricCard label="Win Rate"      value={`${m.winRate}%`} sub={`${m.wins}W / ${m.losses}L`} />
              <MetricCard label="Net P&L"       value={`₹${m.netPnl.toLocaleString()}`} />
              <MetricCard label="Profit Factor" value={m.profitFactor} />
              <MetricCard label="Sharpe Ratio"  value={m.sharpeRatio} />
              <MetricCard label="Max Drawdown"  value={`₹${m.maxDrawdown.toLocaleString()}`} />
              <MetricCard label="Avg Win"       value={`₹${m.avgWin.toLocaleString()}`} />
              <MetricCard label="Avg Loss"      value={`₹${m.avgLoss.toLocaleString()}`} />
              <MetricCard label="ROI"           value={`${m.roi}%`} />
              <MetricCard label="Final Capital" value={`₹${m.finalCapital.toLocaleString()}`} />
            </div>

            {m.equityCurve?.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Equity Curve</h2>
                <EquityChart data={m.equityCurve} initialCapital={effectiveCapital} />
              </div>
            )}

            {display.trades?.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">
                  Trade Log ({display.trades.length})
                </h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700">
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Entry ₹</th>
                      <th className="py-2 px-3">Exit ₹</th>
                      <th className="py-2 px-3">VIX</th>
                      <th className="py-2 px-3">Gap%</th>
                      <th className="py-2 px-3">Lots</th>
                      <th className="py-2 px-3">P&amp;L</th>
                      <th className="py-2 px-3">Exit Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {display.trades.map((t, i) => <TradeRow key={i} t={t} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Previous runs */}
        {pastRuns.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Previous Runs</h2>
            <div className="space-y-2">
              {pastRuns.map((r, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setSelectedRun(r === selectedRun ? null : r);
                    setResult(null);
                  }}
                  className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${
                    selectedRun === r ? 'bg-blue-900' : 'bg-gray-750 hover:bg-gray-700'
                  }`}
                >
                  <span className="text-sm text-gray-300">
                    {r.fromDate} → {r.toDate}
                    <span className="text-xs text-gray-500 ml-2">
                      ₹{r.initialCapital.toLocaleString()} capital
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-medium ${r.result.metrics.netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      ₹{r.result.metrics.netPnl.toLocaleString()}
                    </span>
                    <span className="text-xs text-gray-400">{r.result.metrics.totalTrades} trades</span>
                    <RunStatusBadge status="COMPLETED" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </AppShell>
  );
}
