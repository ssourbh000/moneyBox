'use client';

import { useState, useEffect, useRef } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { Zap, Play, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { orb15BacktestService, } from '@/services/orb15-backtest.service';
import type { OBRun, OBTrade } from '@/services/option-backtest.service';
import MetricCard from '@/components/ui/MetricCard';
import RunStatusBadge from '@/components/ui/RunStatusBadge';
import { TWO_YEARS_AGO, TODAY } from '@/lib/dates';

function TradeRow({ t }: { t: OBTrade }) {
  const [open, setOpen] = useState(false);
  const win = t.netPnl > 0;
  return (
    <>
      <tr
        className="border-b border-gray-700 hover:bg-gray-750 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <td className="py-2 px-3 text-sm text-gray-300">{t.symbol}</td>
        <td className="py-2 px-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${t.direction === 'CALL' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {t.direction}
          </span>
        </td>
        <td className="py-2 px-3 text-sm text-gray-300">{t.strike}</td>
        <td className="py-2 px-3 text-sm text-gray-300">₹{t.entryPremium}</td>
        <td className="py-2 px-3 text-sm text-gray-300">₹{t.exitPremium}</td>
        <td className="py-2 px-3 text-sm text-gray-400">{t.lots}</td>
        <td className={`py-2 px-3 text-sm font-medium ${win ? 'text-green-400' : 'text-red-400'}`}>
          {win ? '+' : ''}₹{t.netPnl.toLocaleString()}
        </td>
        <td className="py-2 px-3 text-xs text-gray-400">{t.exitReason}</td>
        <td className="py-2 px-3 text-xs text-gray-500">{new Date(t.entryTime).toLocaleDateString('en-IN')}</td>
        <td className="py-2 px-3 text-gray-500">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
      </tr>
      {open && (
        <tr className="bg-gray-850 border-b border-gray-700">
          <td colSpan={10} className="px-3 py-2">
            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              <span>VIX: <b className="text-white">{t.vix}</b></span>
              {Object.entries(t.meta).map(([k, v]) => (
                <span key={k}>{k}: <b className="text-white">{String(v)}</b></span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Orb15BacktestPage() {
  const [fromDate, setFromDate] = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]   = useState(TODAY);
  const [capital,  setCapital]  = useState('100000');
  const [customCap, setCustomCap] = useState('');
  const [runs,     setRuns]     = useState<OBRun[]>([]);
  const [selected, setSelected] = useState<OBRun | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = async () => {
    try { setRuns(await orb15BacktestService.list()); } catch { /* ignore */ }
  };

  useEffect(() => { loadRuns(); }, []);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleRun = async () => {
    setLoading(true);
    setStatus('Backtest queued…');
    try {
      const resolvedCapital = capital === 'custom' ? (parseInt(customCap) || 100_000) : (parseInt(capital) || 100_000);
      const run = await orb15BacktestService.run(fromDate, toDate, resolvedCapital);
      setStatus('Running… auto-refreshing every 5s');
      pollRef.current = setInterval(async () => {
        try {
          const updated = await orb15BacktestService.get(run._id);
          if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
            if (pollRef.current) clearInterval(pollRef.current);
            setLoading(false);
            setStatus(updated.status === 'COMPLETED' ? 'Completed' : `Failed: ${updated.errorMessage}`);
            await loadRuns();
            setSelected(updated);
          }
        } catch { if (pollRef.current) clearInterval(pollRef.current); setLoading(false); }
      }, 5000);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setLoading(false);
    }
  };

  const m = selected?.metrics;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Zap size={24} className="text-purple-400" />
          <div>
            <h1 className="text-xl font-bold text-white">A — Breakout Rider</h1>
            <p className="text-sm text-gray-400">
              Wide ORB (9 bars) · EMA direction · 10:00–14:00 · 3 trades/day
            </p>
          </div>
        </div>

        {/* Strategy diff badge */}
        <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap gap-3 text-xs">
          <span className="bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">45-min ORB (9 bars)</span>
          <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded">EMA direction filter</span>
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded">No Supertrend flip</span>
          <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded">10:00–14:00</span>
          <span className="bg-orange-900 text-orange-300 px-2 py-0.5 rounded">3 trades/day</span>
          <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded">20-min cooldown</span>
          <span className="bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded">VIX ≤ 20</span>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-xs text-gray-400 block mb-1">From</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">To</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Capital</label>
              <select value={capital} onChange={e => setCapital(e.target.value)}
                className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600">
                <option value="20000">₹20,000</option>
                <option value="50000">₹50,000</option>
                <option value="100000">₹1,00,000</option>
                <option value="500000">₹5,00,000</option>
                <option value="custom">Custom…</option>
              </select>
            </div>
            {capital === 'custom' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">Amount (₹)</label>
                <input type="number" value={customCap} onChange={e => setCustomCap(e.target.value)}
                  placeholder="e.g. 200000"
                  className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600 w-36" />
              </div>
            )}
            <p className="text-xs text-gray-500 self-end pb-2">
              Uses existing market data — seed from the Option Backtest page if needed
            </p>
            <button
              onClick={handleRun}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-sm"
            >
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {loading ? 'Running…' : 'Run Backtest'}
            </button>
          </div>
          {status && <p className="text-sm text-gray-400">{status}</p>}
        </div>

        {/* Results */}
        {m && selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              <MetricCard label="Total Trades"  value={m.totalTrades} />
              <MetricCard label="Win Rate"       value={`${m.winRate}%`} sub={`${m.wins}W / ${m.losses}L`} />
              <MetricCard label="Net P&L"        value={`₹${m.netPnl.toLocaleString()}`} />
              <MetricCard label="Profit Factor"  value={m.profitFactor} />
              <MetricCard label="Sharpe Ratio"   value={m.sharpeRatio} />
              <MetricCard label="Max Drawdown"   value={`₹${m.maxDrawdown.toLocaleString()}`} />
              <MetricCard label="Avg Win"        value={`₹${m.avgWin.toLocaleString()}`} />
              <MetricCard label="Avg Loss"       value={`₹${m.avgLoss.toLocaleString()}`} />
              <MetricCard label="ROI"            value={`${m.roi}%`} />
              <MetricCard label="Final Capital"  value={`₹${m.finalCapital.toLocaleString()}`} />
            </div>

            {m.equityCurve?.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Equity Curve</h2>
                <EquityChart data={m.equityCurve} initialCapital={m.finalCapital - m.netPnl} />
              </div>
            )}

            {selected.trades && selected.trades.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Trade Log ({selected.trades.length})</h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Dir</th>
                      <th className="py-2 px-3">Strike</th>
                      <th className="py-2 px-3">Entry ₹</th>
                      <th className="py-2 px-3">Exit ₹</th>
                      <th className="py-2 px-3">Lots</th>
                      <th className="py-2 px-3">P&amp;L</th>
                      <th className="py-2 px-3">Reason</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.trades.map((t: OBTrade, i: number) => <TradeRow key={i} t={t} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Previous runs */}
        {runs.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Previous Runs</h2>
            <div className="space-y-2">
              {runs.map((r) => (
                <div
                  key={r._id}
                  onClick={async () => {
                    if (r.status === 'COMPLETED') {
                      const full = await orb15BacktestService.get(r._id);
                      setSelected(full);
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${selected?._id === r._id ? 'bg-purple-900' : 'bg-gray-750 hover:bg-gray-700'}`}
                >
                  <span className="text-sm text-gray-300">
                    {r.fromDate.slice(0, 10)} → {r.toDate.slice(0, 10)}
                  </span>
                  <div className="flex items-center gap-3">
                    {r.metrics && (
                      <span className={`text-sm font-medium ${(r.metrics.netPnl ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ₹{(r.metrics.netPnl ?? 0).toLocaleString()}
                      </span>
                    )}
                    {r.metrics && (
                      <span className="text-xs text-gray-400">{r.metrics.totalTrades} trades</span>
                    )}
                    <RunStatusBadge status={r.status} />
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
