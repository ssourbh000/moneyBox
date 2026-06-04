'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { BarChart2, Play, RefreshCw } from 'lucide-react';
import { portfolioBacktestService, type PortfolioMetrics, type MonthlyRow, type StrategyStats } from '@/services/portfolio-backtest.service';
import type { PortfolioRun } from '@/services/portfolio-backtest.service';

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
const TODAY         = new Date().toISOString().slice(0, 10);

const STRATEGY_COLOR: Record<string, string> = {
  ORB:   'text-purple-400',
  EVENT: 'text-yellow-400',
};
const STRATEGY_BG: Record<string, string> = {
  ORB:   'bg-purple-900 text-purple-200',
  EVENT: 'bg-yellow-900 text-yellow-200',
};
const STRATEGY_LABEL: Record<string, string> = {
  ORB:   'B — ORB Breakout',
  EVENT: 'D — Event Alpha',
};

function pnlColor(v: number) { return v >= 0 ? 'text-green-400' : 'text-red-400'; }
function fmt(v: number) { return (v >= 0 ? '+' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }

function MetricCard({ label, value, sub, highlight }: { label: string; value: string | number; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-4 ${highlight ? 'bg-emerald-900/40 border border-emerald-700' : 'bg-gray-800'}`}>
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${highlight ? 'text-emerald-300' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-800 text-green-200', RUNNING: 'bg-yellow-800 text-yellow-200',
    QUEUED: 'bg-gray-700 text-gray-300', FAILED: 'bg-red-800 text-red-200',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-700 text-gray-300'}`}>{status}</span>;
}

function StrategyTable({ stats }: { stats: StrategyStats[] }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Strategy Breakdown</h2>
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs text-gray-500 border-b border-gray-700">
            <th className="py-2 px-3">Strategy</th>
            <th className="py-2 px-3">Trades</th>
            <th className="py-2 px-3">Win Rate</th>
            <th className="py-2 px-3">Net P&L</th>
            <th className="py-2 px-3">Avg Win</th>
            <th className="py-2 px-3">Avg Loss</th>
            <th className="py-2 px-3">PF</th>
            <th className="py-2 px-3">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.strategy} className="border-b border-gray-700">
              <td className="py-2 px-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${STRATEGY_BG[s.strategy]}`}>
                  {STRATEGY_LABEL[s.strategy]}
                </span>
              </td>
              <td className="py-2 px-3 text-sm text-gray-300">{s.trades}</td>
              <td className="py-2 px-3 text-sm text-gray-300">{s.winRate}%</td>
              <td className={`py-2 px-3 text-sm font-medium ${pnlColor(s.netPnl)}`}>{fmt(s.netPnl)}</td>
              <td className="py-2 px-3 text-sm text-green-400">₹{s.avgWin.toLocaleString()}</td>
              <td className="py-2 px-3 text-sm text-red-400">₹{s.avgLoss.toLocaleString()}</td>
              <td className="py-2 px-3 text-sm text-gray-300">{s.profitFactor}</td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${s.strategy === 'ORB' ? 'bg-purple-500' : 'bg-yellow-500'}`}
                      style={{ width: `${Math.min(100, Math.max(0, s.contribution))}%` }}
                    />
                  </div>
                  <span className={`text-xs font-medium ${STRATEGY_COLOR[s.strategy]}`}>{s.contribution}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MonthlyTable({ rows }: { rows: MonthlyRow[] }) {
  const months = rows.slice().reverse();
  return (
    <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Monthly P&L Breakdown (newest first)</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-gray-500 border-b border-gray-700">
            <th className="py-2 px-3">Month</th>
            <th className="py-2 px-3 text-purple-400">ORB</th>
            <th className="py-2 px-3 text-yellow-400">Event</th>
            <th className="py-2 px-3 text-white">Total</th>
            <th className="py-2 px-3">Trades</th>
          </tr>
        </thead>
        <tbody>
          {months.map(r => {
            const isGoodMonth = r.total > 0;
            return (
              <tr key={r.month} className={`border-b border-gray-700 ${isGoodMonth ? '' : 'opacity-70'}`}>
                <td className="py-2 px-3 text-gray-400 font-medium">{r.month}</td>
                <td className={`py-2 px-3 ${pnlColor(r.orb)}`}>{r.orbN > 0 ? fmt(r.orb) : '—'}</td>
                <td className={`py-2 px-3 ${pnlColor(r.event)}`}>{r.eventN > 0 ? fmt(r.event) : '—'}</td>
                <td className={`py-2 px-3 font-bold ${pnlColor(r.total)}`}>{fmt(r.total)}</td>
                <td className="py-2 px-3 text-gray-500 text-xs">{r.orbN + r.eventN}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function PortfolioBacktestPage() {
  const [fromDate, setFromDate]   = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]     = useState(TODAY);
  const [capital,  setCapital]    = useState('100000');
  const [runs,     setRuns]       = useState<PortfolioRun[]>([]);
  const [selected, setSelected]   = useState<PortfolioRun | null>(null);
  const [loading,  setLoading]    = useState(false);
  const [status,   setStatus]     = useState('');

  const loadRuns = async () => {
    try { setRuns(await portfolioBacktestService.list()); } catch { /* ignore */ }
  };

  useEffect(() => { loadRuns(); }, []);

  const handleRun = async () => {
    setLoading(true);
    setStatus('Queued — running B + D strategies simultaneously…');
    try {
      const run = await portfolioBacktestService.run(fromDate, toDate, parseInt(capital) || 100_000);
      const poll = setInterval(async () => {
        try {
          const updated = await portfolioBacktestService.get(run._id);
          if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
            clearInterval(poll);
            setLoading(false);
            setStatus(updated.status === 'COMPLETED' ? 'Completed' : `Failed: ${updated.errorMessage}`);
            await loadRuns();
            setSelected(updated);
          } else {
            setStatus('Running ORB + Event in parallel…');
          }
        } catch { clearInterval(poll); setLoading(false); }
      }, 5000);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setLoading(false);
    }
  };

  const m: PortfolioMetrics | undefined = selected?.metrics as PortfolioMetrics | undefined;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <BarChart2 size={24} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Portfolio Simulator — B + D</h1>
            <p className="text-sm text-gray-400">
              Runs B (ORB) + D (Event Alpha) together on shared capital
            </p>
          </div>
        </div>

        {/* Strategy legend */}
        <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap gap-3 text-xs">
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded">B — ORB Breakout (daily)</span>
          <span className="bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">D — Event Alpha (monthly)</span>
          <span className="ml-auto text-gray-500">Non-overlapping — each strategy fills a different market regime</span>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
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
            <div>
              <label className="text-xs text-gray-400 block mb-1">Starting Capital (₹)</label>
              <select value={capital} onChange={e => setCapital(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600">
                <option value="20000">₹20,000</option>
                <option value="50000">₹50,000</option>
                <option value="100000">₹1,00,000</option>
                <option value="500000">₹5,00,000</option>
                <option value="1000000">₹10,00,000</option>
              </select>
            </div>
            <button onClick={handleRun} disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? 'Running…' : 'Run Portfolio Backtest'}
            </button>
          </div>
          {status && <p className="text-sm text-gray-400">{status}</p>}
        </div>

        {/* Results */}
        {m && selected && (
          <div className="space-y-4">

            {/* Top metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <MetricCard label="Starting Capital" value={`₹${m.startingCapital.toLocaleString()}`} />
              <MetricCard label="Final Capital"    value={`₹${m.finalCapital.toLocaleString()}`} highlight />
              <MetricCard label="Net P&L"          value={`₹${m.netPnl.toLocaleString()}`} highlight={m.netPnl > 0} />
              <MetricCard label="ROI"              value={`${m.roi}%`} highlight={m.roi > 0} sub={`on ₹${m.startingCapital.toLocaleString()}`} />
              <MetricCard label="Total Trades"     value={m.totalTrades} sub={`${m.wins}W / ${m.losses}L`} />
              <MetricCard label="Overall WR"       value={`${m.winRate}%`} />
              <MetricCard label="Profit Factor"    value={m.profitFactor} />
              <MetricCard label="Sharpe Ratio"     value={m.sharpeRatio} />
              <MetricCard label="Max Drawdown"     value={`₹${m.maxDrawdown.toLocaleString()}`} />
              <MetricCard label="DD / Capital"     value={`${((m.maxDrawdown / m.startingCapital) * 100).toFixed(1)}%`} />
              <MetricCard label="Winning Months"   value={`${m.winningMonths} / ${m.winningMonths + m.losingMonths}`} />
              <MetricCard label="Best Month"       value={fmt(m.bestMonth.pnl)} sub={m.bestMonth.month} />
            </div>

            {/* Strategy stats */}
            {m.strategyStats && <StrategyTable stats={m.strategyStats} />}

            {/* Equity curve */}
            {m.equityCurve?.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Combined Portfolio Equity Curve</h2>
                <EquityChart data={m.equityCurve} initialCapital={m.startingCapital} />
              </div>
            )}

            {/* Monthly breakdown */}
            {m.monthlyBreakdown?.length > 0 && <MonthlyTable rows={m.monthlyBreakdown} />}

          </div>
        )}

        {/* Previous runs */}
        {runs.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Previous Portfolio Runs</h2>
            <div className="space-y-2">
              {runs.map(r => (
                <div key={r._id}
                  onClick={async () => {
                    if (r.status === 'COMPLETED') {
                      const full = await portfolioBacktestService.get(r._id);
                      setSelected(full);
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${selected?._id === r._id ? 'bg-emerald-900' : 'bg-gray-750 hover:bg-gray-700'}`}
                >
                  <span className="text-sm text-gray-300">{r.fromDate.slice(0,10)} → {r.toDate.slice(0,10)}</span>
                  <div className="flex items-center gap-3">
                    {r.metrics && (
                      <>
                        <span className={`text-sm font-medium ${(r.metrics as PortfolioMetrics).netPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmt((r.metrics as PortfolioMetrics).netPnl)}
                        </span>
                        <span className="text-xs text-gray-400">
                          ₹{(r.metrics as PortfolioMetrics).startingCapital?.toLocaleString()} capital
                        </span>
                        <span className="text-xs text-gray-400">
                          {(r.metrics as PortfolioMetrics).totalTrades} trades
                        </span>
                      </>
                    )}
                    <StatusBadge status={r.status} />
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
