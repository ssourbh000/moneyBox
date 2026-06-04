'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { Zap, Play, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { eventAlphaBacktestService } from '@/services/event-alpha-backtest.service';
import type { OBRun } from '@/services/option-backtest.service';

const TWO_YEARS_AGO = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
const TODAY         = new Date().toISOString().slice(0, 10);

type ExitReason = 'TP' | 'SL' | 'TIME_SL' | 'EOD';

interface EATrade {
  symbol: string;
  eventType: string;
  entryTime: string;
  exitTime: string;
  strike: number;
  entryStraddle: number;
  exitStraddle: number;
  lots: number;
  lotSize: number;
  grossPnl: number;
  netPnl: number;
  exitReason: ExitReason;
  vix: number;
  gapPct: number;
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

const REASON_COLOR: Record<ExitReason, string> = {
  TP:      'text-green-400',
  SL:      'text-red-400',
  TIME_SL: 'text-orange-400',
  EOD:     'text-gray-400',
};

const EVENT_COLOR: Record<string, string> = {
  HARDCODED: 'bg-yellow-900 text-yellow-300',
  VIX_SPIKE: 'bg-orange-900 text-orange-300',
  GAP:       'bg-blue-900 text-blue-300',
};

function TradeRow({ t }: { t: EATrade }) {
  const [open, setOpen] = useState(false);
  const win = t.netPnl > 0;
  const returnPct = ((t.exitStraddle - t.entryStraddle) / t.entryStraddle * 100).toFixed(1);
  return (
    <>
      <tr className="border-b border-gray-700 hover:bg-gray-750 cursor-pointer" onClick={() => setOpen(!open)}>
        <td className="py-2 px-3 text-sm text-gray-300">{t.symbol.replace('NIFTY ', '')}</td>
        <td className="py-2 px-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${EVENT_COLOR[t.eventType] ?? 'bg-gray-700 text-gray-300'}`}>
            {t.eventType.replace('_', ' ')}
          </span>
        </td>
        <td className="py-2 px-3 text-sm text-gray-300">{t.strike}</td>
        <td className="py-2 px-3 text-sm text-gray-300">₹{t.entryStraddle}</td>
        <td className="py-2 px-3 text-sm text-gray-300">
          ₹{t.exitStraddle}
          <span className={`ml-1 text-xs ${parseFloat(returnPct) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            ({returnPct}%)
          </span>
        </td>
        <td className="py-2 px-3 text-sm text-gray-400">{t.lots}</td>
        <td className={`py-2 px-3 text-sm font-medium ${win ? 'text-green-400' : 'text-red-400'}`}>
          {win ? '+' : ''}₹{t.netPnl.toLocaleString()}
        </td>
        <td className={`py-2 px-3 text-xs font-medium ${REASON_COLOR[t.exitReason]}`}>{t.exitReason}</td>
        <td className="py-2 px-3 text-xs text-gray-500">{new Date(t.entryTime).toLocaleDateString('en-IN')}</td>
        <td className="py-2 px-3 text-gray-500">{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
      </tr>
      {open && (
        <tr className="bg-gray-850 border-b border-gray-700">
          <td colSpan={10} className="px-3 py-2">
            <div className="flex flex-wrap gap-3 text-xs text-gray-400">
              <span>VIX: <b className="text-white">{t.vix}</b></span>
              <span>Gap: <b className="text-white">{(t.gapPct * 100).toFixed(2)}%</b></span>
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

export default function EventAlphaBacktestPage() {
  const [fromDate, setFromDate] = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]   = useState(TODAY);
  const [runs,     setRuns]     = useState<OBRun[]>([]);
  const [selected, setSelected] = useState<OBRun | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [status,   setStatus]   = useState('');

  const loadRuns = async () => {
    try { setRuns(await eventAlphaBacktestService.list()); } catch { /* ignore */ }
  };

  useEffect(() => { loadRuns(); }, []);

  const handleRun = async () => {
    setLoading(true);
    setStatus('Backtest queued…');
    try {
      const run = await eventAlphaBacktestService.run(fromDate, toDate);
      setStatus('Running… auto-refreshing every 5s');
      const poll = setInterval(async () => {
        try {
          const updated = await eventAlphaBacktestService.get(run._id);
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
  const tradeList: EATrade[] = (selected?.trades as unknown as EATrade[]) ?? [];

  const byReason  = tradeList.reduce<Record<string, number>>((acc, t) => { acc[t.exitReason] = (acc[t.exitReason] ?? 0) + 1; return acc; }, {});
  const byEvent   = tradeList.reduce<Record<string, number>>((acc, t) => { acc[t.eventType] = (acc[t.eventType] ?? 0) + 1; return acc; }, {});
  const bySymbol  = tradeList.reduce<Record<string, number>>((acc, t) => { const k = t.symbol.replace('NIFTY ', ''); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Zap size={24} className="text-yellow-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Strategy D — Event Alpha</h1>
            <p className="text-sm text-gray-400">
              ATM Straddle · RBI / Budget / FOMC / VIX spike / Gap days · NIFTY + BankNifty
            </p>
          </div>
        </div>

        {/* Strategy badges */}
        <div className="bg-gray-800 rounded-lg p-3 flex flex-wrap gap-3 text-xs">
          <span className="bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">Hardcoded events (RBI/Budget/FOMC)</span>
          <span className="bg-orange-900 text-orange-300 px-2 py-0.5 rounded">VIX spike proxy (&gt;18)</span>
          <span className="bg-blue-900 text-blue-300 px-2 py-0.5 rounded">Gap proxy (&gt;1.2%)</span>
          <span className="bg-green-900 text-green-300 px-2 py-0.5 rounded">TP at 1.5× straddle</span>
          <span className="bg-red-900 text-red-300 px-2 py-0.5 rounded">SL at 40%</span>
          <span className="bg-gray-700 text-gray-300 px-2 py-0.5 rounded">Entry 9:20 AM</span>
          <span className="bg-purple-900 text-purple-300 px-2 py-0.5 rounded">Time SL 1:30 PM</span>
          <span className="bg-indigo-900 text-indigo-300 px-2 py-0.5 rounded">Max risk ₹5 000/trade</span>
        </div>

        {/* Strategy explanation */}
        <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-white font-medium mb-1">Edge</p>
            <p>On event days, markets make 2–4%+ moves. A straddle profits from ANY direction — you just need the move to exceed the premium paid.</p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">When it wins</p>
            <p>RBI rate surprises, Budget shocks, election results, US Fed pivots, global crisis days. Any day with a big directional move.</p>
          </div>
          <div>
            <p className="text-white font-medium mb-1">When it loses</p>
            <p>Flat days with no follow-through. Market opens volatile then stabilises. IV crush after a non-surprise event.</p>
          </div>
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
              className="flex items-center gap-2 px-4 py-1.5 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded text-sm"
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

            {/* Breakdown */}
            {tradeList.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-xs text-gray-400 mb-2">Exit Breakdown</h3>
                  <div className="flex gap-4 flex-wrap">
                    {Object.entries(byReason).map(([k, v]) => (
                      <div key={k}><p className="text-xs text-gray-500">{k}</p><p className={`text-lg font-bold ${REASON_COLOR[k as ExitReason] ?? 'text-white'}`}>{v}</p></div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-xs text-gray-400 mb-2">Event Source</h3>
                  <div className="flex gap-4 flex-wrap">
                    {Object.entries(byEvent).map(([k, v]) => (
                      <div key={k}><p className="text-xs text-gray-500">{k.replace('_', ' ')}</p><p className="text-lg font-bold text-yellow-400">{v}</p></div>
                    ))}
                  </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-xs text-gray-400 mb-2">By Instrument</h3>
                  <div className="flex gap-4 flex-wrap">
                    {Object.entries(bySymbol).map(([k, v]) => (
                      <div key={k}><p className="text-xs text-gray-500">{k}</p><p className="text-lg font-bold text-white">{v}</p></div>
                    ))}
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
                      <th className="py-2 px-3">Event</th>
                      <th className="py-2 px-3">Strike</th>
                      <th className="py-2 px-3">Entry ₹</th>
                      <th className="py-2 px-3">Exit ₹</th>
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
                      const full = await eventAlphaBacktestService.get(r._id);
                      setSelected(full);
                    }
                  }}
                  className={`flex items-center justify-between p-3 rounded cursor-pointer transition-colors ${selected?._id === r._id ? 'bg-yellow-900' : 'bg-gray-750 hover:bg-gray-700'}`}
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
