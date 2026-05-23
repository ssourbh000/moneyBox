'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { TrendingDown, Play, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { expirySpreadBacktestService } from '@/services/expiry-spread-backtest.service';
import type { OBRun } from '@/services/option-backtest.service';

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
const TODAY         = new Date().toISOString().slice(0, 10);

type SpreadDir = 'BULL_PUT' | 'BEAR_CALL' | 'IRON_CONDOR';

interface ESTrade {
  symbol: string;
  direction: SpreadDir;
  entryTime: string;
  exitTime: string;
  shortPutStrike: number | null;
  longPutStrike: number | null;
  shortCallStrike: number | null;
  longCallStrike: number | null;
  entryPremiumNet: number;
  exitPremiumNet: number;
  spreadWidth: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: 'TP' | 'SL' | 'EOD';
  vix: number;
  meta: Record<string, string | number>;
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-lg font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-800 text-green-200',
    RUNNING:   'bg-yellow-800 text-yellow-200',
    QUEUED:    'bg-gray-700 text-gray-300',
    FAILED:    'bg-red-800 text-red-200',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? 'bg-gray-700 text-gray-300'}`}>
      {status}
    </span>
  );
}

const DIR_COLOR: Record<SpreadDir, string> = {
  BULL_PUT:     'bg-green-900 text-green-300',
  BEAR_CALL:    'bg-red-900 text-red-300',
  IRON_CONDOR:  'bg-purple-900 text-purple-300',
};

const REASON_COLOR: Record<string, string> = {
  TP:  'text-green-400',
  SL:  'text-red-400',
  EOD: 'text-gray-400',
};

function strikeLabel(t: ESTrade): string {
  if (t.direction === 'BULL_PUT')    return `${t.shortPutStrike}/${t.longPutStrike} PE`;
  if (t.direction === 'BEAR_CALL')   return `${t.shortCallStrike}/${t.longCallStrike} CE`;
  return `${t.shortPutStrike}/${t.longPutStrike} PE | ${t.shortCallStrike}/${t.longCallStrike} CE`;
}

function TradeRow({ t }: { t: ESTrade }) {
  const [open, setOpen] = useState(false);
  const win = t.netPnl > 0;
  return (
    <>
      <tr
        className="border-b border-gray-700 hover:bg-gray-750 cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <td className="py-2 px-3 text-sm text-gray-300">{t.symbol.replace('NIFTY ', '')}</td>
        <td className="py-2 px-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${DIR_COLOR[t.direction]}`}>
            {t.direction === 'BULL_PUT' ? 'Bull Put' : t.direction === 'BEAR_CALL' ? 'Bear Call' : 'IC'}
          </span>
        </td>
        <td className="py-2 px-3 text-xs text-gray-400 max-w-[180px] truncate">{strikeLabel(t)}</td>
        <td className="py-2 px-3 text-sm text-gray-300">₹{t.entryPremiumNet}</td>
        <td className="py-2 px-3 text-sm text-gray-300">₹{t.exitPremiumNet}</td>
        <td className="py-2 px-3 text-sm text-gray-400">{t.lots}</td>
        <td className={`py-2 px-3 text-sm font-medium ${win ? 'text-green-400' : 'text-red-400'}`}>
          {win ? '+' : ''}₹{t.netPnl.toLocaleString()}
        </td>
        <td className={`py-2 px-3 text-xs font-medium ${REASON_COLOR[t.exitReason] ?? 'text-gray-400'}`}>
          {t.exitReason}
        </td>
        <td className="py-2 px-3 text-xs text-gray-500">{new Date(t.entryTime).toLocaleDateString('en-IN')}</td>
        <td className="py-2 px-3 text-gray-500">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
      </tr>
      {open && (
        <tr className="bg-gray-850 border-b border-gray-700">
          <td colSpan={10} className="px-3 py-2">
            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              <span>VIX: <b className="text-white">{t.vix}</b></span>
              <span>Width: <b className="text-white">₹{t.spreadWidth}</b></span>
              <span>Lot size: <b className="text-white">{t.lotSize}</b></span>
              <span>Max loss/lot: <b className="text-white">₹{((t.spreadWidth - t.entryPremiumNet) * t.lotSize).toFixed(0)}</b></span>
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

export default function ExpirySpreadBacktestPage() {
  const [fromDate, setFromDate] = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]   = useState(TODAY);
  const [runs,     setRuns]     = useState<OBRun[]>([]);
  const [selected, setSelected] = useState<OBRun | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState('');

  const loadRuns = async () => {
    try { setRuns(await expirySpreadBacktestService.list()); } catch { /* ignore */ }
  };

  useEffect(() => { loadRuns(); }, []);

  const handleRun = async () => {
    setLoading(true);
    setStatus('Backtest queued…');
    try {
      const run = await expirySpreadBacktestService.run(fromDate, toDate);
      setStatus('Running… auto-refreshing every 5s');
      const poll = setInterval(async () => {
        try {
          const updated = await expirySpreadBacktestService.get(run._id);
          if (updated.status === 'COMPLETED' || updated.status === 'FAILED') {
            clearInterval(poll);
            setLoading(false);
            setStatus(updated.status === 'COMPLETED' ? 'Completed' : `Failed: ${updated.errorMessage}`);
            await loadRuns();
            setSelected(updated);
          }
        } catch { clearInterval(poll); setLoading(false); }
      }, 5000);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
      setLoading(false);
    }
  };

  const m = selected?.metrics;

  // breakdown by exit reason
  const tradeList: ESTrade[] = selected?.trades ?? [];
  const tpCount   = tradeList.filter(t => t.exitReason === 'TP').length;
  const slCount   = tradeList.filter(t => t.exitReason === 'SL').length;
  const eodCount  = tradeList.filter(t => t.exitReason === 'EOD').length;
  const icCount   = tradeList.filter(t => t.direction === 'IRON_CONDOR').length;
  const bpCount   = tradeList.filter(t => t.direction === 'BULL_PUT').length;
  const bcCount   = tradeList.filter(t => t.direction === 'BEAR_CALL').length;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <TrendingDown size={24} className="text-amber-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Strategy C — Expiry Day Spread Selling</h1>
            <p className="text-sm text-gray-400">
              Bull Put · Bear Call · Iron Condor · NIFTY (Thu) · BankNifty (Wed) · VIX ≤ 25
            </p>
          </div>
        </div>

        {/* Strategy badges */}
        <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap gap-3 text-xs">
          <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded">Bull Put Spread</span>
          <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded">Bear Call Spread</span>
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded">Iron Condor</span>
          <span className="bg-amber-900 text-amber-300 px-2 py-0.5 rounded">Entry 10:30 AM</span>
          <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded">TP: 70% decay</span>
          <span className="bg-orange-900 text-orange-300 px-2 py-0.5 rounded">SL: strike breach</span>
          <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded">Exit 3:15 PM</span>
          <span className="bg-rose-900 text-rose-300 px-2 py-0.5 rounded">VIX ≤ 25</span>
          <span className="bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded">Max risk ₹2 000/trade</span>
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
            <p className="text-xs text-gray-500 self-end pb-2">
              Requires 5-min data for NIFTY 50 + NIFTY BANK + INDIA VIX daily
            </p>
            <button
              onClick={handleRun}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-sm"
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

            {/* Exit & direction breakdown */}
            {tradeList.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-xs text-gray-400 mb-2">Exit Breakdown</h3>
                  <div className="flex gap-4">
                    <div><p className="text-xs text-gray-500">TP (70% profit)</p><p className="text-lg font-bold text-green-400">{tpCount}</p></div>
                    <div><p className="text-xs text-gray-500">SL (strike breach)</p><p className="text-lg font-bold text-red-400">{slCount}</p></div>
                    <div><p className="text-xs text-gray-500">EOD (3:15 PM)</p><p className="text-lg font-bold text-gray-400">{eodCount}</p></div>
                  </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-xs text-gray-400 mb-2">Direction Mix</h3>
                  <div className="flex gap-4">
                    <div><p className="text-xs text-gray-500">Bull Put</p><p className="text-lg font-bold text-green-400">{bpCount}</p></div>
                    <div><p className="text-xs text-gray-500">Bear Call</p><p className="text-lg font-bold text-red-400">{bcCount}</p></div>
                    <div><p className="text-xs text-gray-500">Iron Condor</p><p className="text-lg font-bold text-purple-400">{icCount}</p></div>
                  </div>
                </div>
              </div>
            )}

            {m.equityCurve?.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Equity Curve</h2>
                <EquityChart data={m.equityCurve} initialCapital={1_000_000} />
              </div>
            )}

            {tradeList.length > 0 && (
              <div className="bg-gray-800 rounded-lg p-4 overflow-x-auto">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Trade Log ({tradeList.length})</h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-700">
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Strikes</th>
                      <th className="py-2 px-3">Entry Net ₹</th>
                      <th className="py-2 px-3">Exit Net ₹</th>
                      <th className="py-2 px-3">Lots</th>
                      <th className="py-2 px-3">P&amp;L</th>
                      <th className="py-2 px-3">Exit</th>
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeList.map((t, i) => <TradeRow key={i} t={t} />)}
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
                      const full = await expirySpreadBacktestService.get(r._id);
                      setSelected(full);
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${selected?._id === r._id ? 'bg-amber-900' : 'bg-gray-750 hover:bg-gray-700'}`}
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
                    {r.metrics && <span className="text-xs text-gray-400">{r.metrics.totalTrades} trades</span>}
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
