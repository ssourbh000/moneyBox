'use client';

import { useState, useEffect, useCallback } from 'react';
import { Zap } from 'lucide-react';
import api from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IVCTrade {
  date: string;
  status: 'OPEN' | 'CLOSED' | 'SKIPPED' | 'WAITING';
  entryTime?: string;
  exitTime?: string;
  spot?: number;
  strike?: number;
  entryStraddle?: number;
  exitStraddle?: number;
  lots?: number;
  vix?: number;
  gapPct?: number;
  grossPnl?: number;
  netPnl?: number;
  exitReason?: string;
  skipReason?: string;
  currentStraddle?: number;
  currentPnl?: number;
  lastUpdated?: string;
}

interface Summary {
  total: number;
  wins: number;
  losses: number;
  skipped: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
}

interface LastTick {
  time: string;
  istHHMM: number;
  status: string;
  message: string;
  trade?: {
    spot: number;
    strike: number;
    entryStraddle: number;
    currentStraddle: number;
    pnlPct: number;
    pnl: number;
    lots: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ivCrushService = {
  today:     () => api.get<IVCTrade>('/iv-crush/today').then(r => r.data),
  recent:    (days = 60) => api.get<IVCTrade[]>(`/iv-crush/recent?days=${days}`).then(r => r.data),
  summary:   (days = 60) => api.get<Summary>(`/iv-crush/summary?days=${days}`).then(r => r.data),
  lastTick:  () => api.get<LastTick>('/iv-crush/last-tick').then(r => r.data),
  forceTick: () => api.post<LastTick>('/iv-crush/force-tick').then(r => r.data),
};

function statusBadge(status: string) {
  const map: Record<string, string> = {
    OPEN:    'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40',
    CLOSED:  'bg-zinc-700 text-zinc-300',
    SKIPPED: 'bg-zinc-800 text-zinc-500',
    WAITING: 'bg-blue-500/20 text-blue-300',
  };
  return `px-2 py-0.5 rounded text-xs font-semibold ${map[status] ?? 'bg-zinc-700 text-zinc-400'}`;
}

function pnlColor(v: number) {
  return v > 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-zinc-400';
}

// ── Today card ────────────────────────────────────────────────────────────────

function TodayCard({ trade }: { trade: IVCTrade | null }) {
  if (!trade) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 border border-zinc-800">
        <p className="text-zinc-500 text-sm">No trade today yet — engine fires at 9:20 AM IST</p>
      </div>
    );
  }

  return (
    <div className={`bg-zinc-900 rounded-xl p-6 border ${
      trade.status === 'OPEN' ? 'border-yellow-500/50' :
      trade.status === 'CLOSED' && (trade.netPnl ?? 0) > 0 ? 'border-green-500/40' :
      trade.status === 'CLOSED' ? 'border-red-500/30' :
      'border-zinc-800'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white font-bold text-lg">Today — {trade.date}</h3>
        <span className={statusBadge(trade.status)}>{trade.status}</span>
      </div>

      {trade.status === 'SKIPPED' && (
        <p className="text-zinc-500 text-sm">Skipped: {trade.skipReason}</p>
      )}

      {(trade.status === 'OPEN' || trade.status === 'CLOSED') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-zinc-500 text-xs">Spot</p>
            <p className="text-white font-mono font-bold">{trade.spot?.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Strike</p>
            <p className="text-white font-mono font-bold">{trade.strike}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Entry Straddle</p>
            <p className="text-white font-mono font-bold">₹{trade.entryStraddle}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Lots</p>
            <p className="text-white font-mono font-bold">{trade.lots} × 25</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">VIX</p>
            <p className="text-white font-mono">{trade.vix}</p>
          </div>
          <div>
            <p className="text-zinc-500 text-xs">Gap</p>
            <p className={`font-mono ${Math.abs(trade.gapPct ?? 0) > 0.5 ? 'text-yellow-400' : 'text-white'}`}>
              {trade.gapPct?.toFixed(2)}%
            </p>
          </div>

          {trade.status === 'OPEN' && (
            <>
              <div>
                <p className="text-zinc-500 text-xs">Current Straddle</p>
                <p className="text-yellow-300 font-mono font-bold">₹{trade.currentStraddle}</p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs">Live P&L</p>
                <p className={`font-mono font-bold ${pnlColor(trade.currentPnl ?? 0)}`}>
                  {(trade.currentPnl ?? 0) >= 0 ? '+' : ''}₹{trade.currentPnl?.toLocaleString()}
                </p>
              </div>
            </>
          )}

          {trade.status === 'CLOSED' && (
            <>
              <div>
                <p className="text-zinc-500 text-xs">Exit Straddle</p>
                <p className="text-white font-mono font-bold">₹{trade.exitStraddle}</p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs">Net P&L</p>
                <p className={`font-mono font-bold text-lg ${pnlColor(trade.netPnl ?? 0)}`}>
                  {(trade.netPnl ?? 0) >= 0 ? '+' : ''}₹{trade.netPnl?.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-zinc-500 text-xs">Exit</p>
                <p className={`font-mono font-bold ${
                  trade.exitReason === 'TP' ? 'text-green-400' :
                  trade.exitReason === 'SL' ? 'text-red-400' : 'text-zinc-300'
                }`}>{trade.exitReason}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ s }: { s: Summary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Net P&L', value: `₹${s.netPnl.toLocaleString()}`, color: s.netPnl >= 0 ? 'text-green-400' : 'text-red-400' },
        { label: 'Win Rate', value: `${s.winRate}%`, sub: `${s.wins}W / ${s.losses}L` },
        { label: 'Trades', value: s.total, sub: `${s.skipped} skipped` },
        { label: 'Profit Factor', value: s.profitFactor },
        { label: 'Avg Win', value: `₹${s.avgWin.toLocaleString()}`, color: 'text-green-400' },
        { label: 'Avg Loss', value: `₹${s.avgLoss.toLocaleString()}`, color: 'text-red-400' },
      ].map(({ label, value, sub, color }) => (
        <div key={label} className="bg-zinc-900 rounded-lg p-3">
          <p className="text-zinc-500 text-xs">{label}</p>
          <p className={`font-bold text-lg ${color ?? 'text-white'}`}>{value}</p>
          {sub && <p className="text-zinc-600 text-xs">{sub}</p>}
        </div>
      ))}
    </div>
  );
}

// ── Last tick panel ───────────────────────────────────────────────────────────

function LastTickPanel({ tick, onForce, forcing }: { tick: LastTick | null; onForce: () => void; forcing: boolean }) {
  const statusColor: Record<string, string> = {
    OPEN:    'text-yellow-300',
    CLOSED:  'text-green-400',
    SKIPPED: 'text-zinc-500',
    WAITING: 'text-blue-400',
    ERROR:   'text-red-400',
    OUTSIDE_WINDOW: 'text-zinc-600',
  };

  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-zinc-400 text-sm font-semibold">Last Cron Tick</h4>
        <button
          onClick={onForce}
          disabled={forcing}
          className="flex items-center gap-1 bg-yellow-600 hover:bg-yellow-500 disabled:bg-zinc-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
        >
          <Zap size={12} />
          {forcing ? 'Ticking…' : 'Force Tick'}
        </button>
      </div>
      {!tick ? (
        <p className="text-zinc-600 text-sm">No tick yet — engine fires every 5 min, 9:15–10:15 AM IST</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className={`text-sm font-semibold ${statusColor[tick.status] ?? 'text-zinc-400'}`}>{tick.status}</span>
            <span className="text-zinc-600 text-xs">{new Date(tick.time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
          </div>
          <p className="text-zinc-300 text-sm font-mono">{tick.message}</p>
          {tick.trade && (
            <div className="bg-zinc-800 rounded-lg p-3 grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-zinc-500">Entry:</span> <span className="text-white font-mono">₹{tick.trade.entryStraddle.toFixed(1)}</span></div>
              <div><span className="text-zinc-500">Current:</span> <span className="text-yellow-300 font-mono">₹{tick.trade.currentStraddle.toFixed(1)}</span></div>
              <div><span className="text-zinc-500">P&L:</span> <span className={`font-mono font-bold ${pnlColor(tick.trade.pnl)}`}>{tick.trade.pnl >= 0 ? '+' : ''}₹{tick.trade.pnl}</span></div>
              <div><span className="text-zinc-500">Spot:</span> <span className="text-white font-mono">{tick.trade.spot.toLocaleString()}</span></div>
              <div><span className="text-zinc-500">Strike:</span> <span className="text-white font-mono">{tick.trade.strike}</span></div>
              <div><span className="text-zinc-500">Decay:</span> <span className={`font-mono ${tick.trade.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{tick.trade.pnlPct.toFixed(1)}%</span></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Trade log ─────────────────────────────────────────────────────────────────

function TradeLog({ trades }: { trades: IVCTrade[] }) {
  return (
    <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
      <h4 className="text-zinc-400 text-sm font-semibold mb-3">Trade History</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-zinc-300 border-collapse">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="py-2 pr-3 text-left">Date</th>
              <th className="py-2 pr-3 text-right">Spot</th>
              <th className="py-2 pr-3 text-right">Strike</th>
              <th className="py-2 pr-3 text-right">Entry ₹</th>
              <th className="py-2 pr-3 text-right">Exit ₹</th>
              <th className="py-2 pr-3 text-right">Net P&L</th>
              <th className="py-2 pr-3 text-center">Exit</th>
              <th className="py-2 pr-3 text-right">VIX</th>
              <th className="py-2 pr-3 text-right">Gap%</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t, i) => (
              <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className="py-1.5 pr-3 font-mono">{t.date}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{t.spot?.toLocaleString() ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{t.strike ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{t.entryStraddle ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right font-mono">{t.exitStraddle ?? '—'}</td>
                <td className={`py-1.5 pr-3 text-right font-mono font-bold ${
                  t.status === 'SKIPPED' ? 'text-zinc-600' : pnlColor(t.netPnl ?? 0)
                }`}>
                  {t.status === 'SKIPPED' ? 'SKIP' :
                   t.status === 'OPEN' ? <span className="text-yellow-400">{t.currentPnl != null ? `${t.currentPnl >= 0 ? '+' : ''}₹${t.currentPnl}` : 'OPEN'}</span> :
                   t.netPnl != null ? `${t.netPnl >= 0 ? '+' : ''}₹${t.netPnl.toLocaleString()}` : '—'}
                </td>
                <td className="py-1.5 pr-3 text-center">
                  {t.exitReason ? (
                    <span className={`px-1.5 rounded ${
                      t.exitReason === 'TP' ? 'bg-green-900/60 text-green-300' :
                      t.exitReason === 'SL' ? 'bg-red-900/60 text-red-300' :
                      'bg-zinc-700 text-zinc-400'
                    }`}>{t.exitReason}</span>
                  ) : (
                    <span className="text-zinc-600">{t.status === 'SKIPPED' ? `${t.skipReason?.slice(0,12)}…` : '—'}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-right">{t.vix ?? '—'}</td>
                <td className="py-1.5 pr-3 text-right">{t.gapPct != null ? `${t.gapPct}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {trades.length === 0 && (
          <p className="text-zinc-600 text-sm text-center py-6">No trades yet</p>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function IVCrushPage() {
  const [today, setToday]     = useState<IVCTrade | null>(null);
  const [recent, setRecent]   = useState<IVCTrade[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [lastTick, setLastTick] = useState<LastTick | null>(null);
  const [forcing, setForcing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, r, s, lt] = await Promise.all([
        ivCrushService.today().catch(() => null),
        ivCrushService.recent(60),
        ivCrushService.summary(60),
        ivCrushService.lastTick().catch(() => null),
      ]);
      setToday(t);
      setRecent(r);
      setSummary(s);
      if (lt) setLastTick(lt);
    } catch (_) {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh every 1 min
    return () => clearInterval(id);
  }, [load]);

  const handleForceTick = async () => {
    setForcing(true);
    try {
      const lt = await ivCrushService.forceTick();
      if (lt) setLastTick(lt);
      setTimeout(load, 1500);
    } finally {
      setForcing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Zap className="text-yellow-400" size={24} />
              C1 — Opening IV Crush
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Sell ATM straddle at 9:20 AM · Exit by 10:00 AM · Gap filter 0.8% · Target 15% decay
            </p>
          </div>
          <div className="text-right text-xs text-zinc-600">
            <p>Strategy: Paper Trading</p>
            <p>NIFTY 50 · 1 lot (25 qty)</p>
          </div>
        </div>

        {/* Today */}
        <TodayCard trade={today} />

        {/* Summary */}
        {summary && summary.total > 0 && (
          <div>
            <h3 className="text-zinc-400 text-sm font-semibold mb-3">Last 60 Days</h3>
            <SummaryCards s={summary} />
          </div>
        )}

        {/* Last tick */}
        <LastTickPanel tick={lastTick} onForce={handleForceTick} forcing={forcing} />

        {/* Trade log */}
        <TradeLog trades={recent} />
      </div>
    </div>
  );
}
