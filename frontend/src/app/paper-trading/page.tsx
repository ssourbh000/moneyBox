'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { Activity, RefreshCw, Zap, Clock, TrendingUp, TrendingDown } from 'lucide-react';
import { liveSignalService } from '@/services/option-backtest.service';
import { fmt, pnlCls, exitReasonCls, statusBadge, isEngineActive } from '@/lib/trade-fmt';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaperTrade {
  _id: string;
  symbol: string;
  direction: 'CALL' | 'PUT';
  strike: number;
  entryPremium: number;
  exitPremium?: number;
  entryTime: string;
  exitTime?: string;
  exitReason?: string;
  status: string;
  slPremium: number;
  lots: number;
  lotSize: number;
  netPnl?: number;
  vix: number;
  regime?: string;
  peakPremium?: number;
  trailSL?: boolean;
  meta?: Record<string, string | number>;
}

interface Account {
  startingCapital: number;
  equity: number;
  netPnl: number;
  roi: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

interface LastTick {
  time: string;
  vix: number;
  regime: string;
  results: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function regimeBadge(regime?: string) {
  if (!regime) return null;
  const cls =
    regime === 'NORMAL' ? 'bg-emerald-500/10 text-emerald-400' :
    regime === 'HIGH'   ? 'bg-yellow-500/10 text-yellow-400'   :
    'bg-red-500/10 text-red-400';
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{regime}</span>;
}

function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function istDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Today Card ────────────────────────────────────────────────────────────────

function TodayCard({ open, today }: { open: PaperTrade[]; today: PaperTrade[] }) {
  if (today.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-6">
        <p className="text-gray-500 text-sm">No trade today yet — engine fires every 5 min, 9:15 AM – 3:00 PM IST</p>
      </div>
    );
  }

  const t = today[today.length - 1];
  const isOpen = t.status === 'OPEN';
  const borderCls = isOpen ? 'border-yellow-500/40' :
    (t.netPnl ?? 0) > 0 ? 'border-emerald-500/30' : 'border-red-500/20';

  return (
    <div className={`bg-gray-800 rounded-xl border ${borderCls} px-5 py-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold text-base">Today — {istDate(t.entryTime)}</h3>
          {regimeBadge(t.regime)}
        </div>
        <span className={statusBadge(t.status)}>{t.status}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Direction</p>
          <div className="flex items-center gap-1.5">
            {t.direction === 'CALL'
              ? <TrendingUp className="w-4 h-4 text-emerald-400" />
              : <TrendingDown className="w-4 h-4 text-red-400" />}
            <span className="text-white font-mono font-bold">{t.direction}</span>
          </div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Strike</p>
          <p className="text-white font-mono font-bold">{t.strike}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Entry Premium</p>
          <p className="text-white font-mono font-bold">₹{t.entryPremium}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Lots</p>
          <p className="text-white font-mono font-bold">{t.lots} × {t.lotSize}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">VIX</p>
          <p className="text-white font-mono">{t.vix?.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Entry Time</p>
          <p className="text-white font-mono">{istTime(t.entryTime)}</p>
        </div>

        {isOpen && (
          <>
            <div>
              <p className="text-xs text-gray-500 mb-1">Peak Premium</p>
              <p className="text-emerald-400 font-mono font-bold">₹{t.peakPremium ?? t.entryPremium}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Stop Loss</p>
              <p className="text-red-400 font-mono font-bold">₹{t.slPremium}</p>
            </div>
          </>
        )}

        {!isOpen && t.exitPremium != null && (
          <>
            <div>
              <p className="text-xs text-gray-500 mb-1">Exit Premium</p>
              <p className="text-white font-mono font-bold">₹{t.exitPremium}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Net P&amp;L</p>
              <p className={`font-mono font-bold text-lg ${pnlCls(t.netPnl ?? 0)}`}>{fmt(t.netPnl ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Exit</p>
              <p className={`font-mono font-bold ${exitReasonCls(t.exitReason)}`}>{t.exitReason}</p>
            </div>
          </>
        )}
      </div>

      {t.meta && (
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-600">
          {t.meta.orbHigh  && <span>ORB {t.meta.orbHigh}/{t.meta.orbLow}</span>}
          {t.meta.vwap     && <span>VWAP {t.meta.vwap}</span>}
          {t.meta.ema9     && <span>EMA {t.meta.ema9}/{t.meta.ema21}</span>}
          {t.meta.rsi      && <span>RSI {t.meta.rsi}</span>}
          {t.meta.adx      && <span>ADX {t.meta.adx}</span>}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaperTradingPage() {
  const [account,  setAccount]  = useState<Account | null>(null);
  const [trades,   setTrades]   = useState<PaperTrade[]>([]);
  const [lastTick, setLastTick] = useState<LastTick | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [forcing,  setForcing]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, recent, tick] = await Promise.all([
        liveSignalService.account(),
        liveSignalService.recent(60),
        liveSignalService.lastTick(),
      ]);
      setAccount(acc);
      setTrades(recent);
      setLastTick(tick);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleForceTick = useCallback(async () => {
    setForcing(true);
    try {
      const result = await liveSignalService.forceTick();
      if (result) setLastTick(result);
      setTimeout(load, 2000);
    } finally {
      setForcing(false);
    }
  }, [load]);

  const today = trades.filter(t => {
    const d   = new Date(t.entryTime).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    const now = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    return d === now;
  });
  const open   = trades.filter(t => t.status === 'OPEN');
  const closed = trades.filter(t => t.status === 'CLOSED');

  const active = isEngineActive(lastTick, 'results');

  return (
    <AppShell mainClassName={active ? 'bg-emerald-950/40' : 'bg-gray-950/60'}>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">B — 45-min ORB</h1>
            <p className="text-gray-500 text-sm mt-1">
              45-min opening range · EMA direction · 10:00–14:00 · 3 trades/day
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded font-medium ${active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700 text-gray-500'}`}>
              {active ? '● Live' : '○ Inactive'}
            </span>
            <span className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-medium">Paper Mode</span>
            <button
              onClick={handleForceTick}
              disabled={forcing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 ${forcing ? 'animate-pulse' : ''}`} />
              {forcing ? 'Ticking…' : 'Force Tick'}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Last Cron Tick panel */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium text-gray-300">Last Cron Tick</span>
              {lastTick && (
                <span className="text-xs text-gray-600">
                  {new Date(lastTick.time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
                </span>
              )}
            </div>
            {lastTick && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">VIX {lastTick.vix}</span>
                {regimeBadge(lastTick.regime)}
              </div>
            )}
          </div>
          {!lastTick ? (
            <p className="text-xs text-gray-600">No tick recorded yet — engine fires every 5 min during market hours (9:15 AM – 3:00 PM IST)</p>
          ) : (
            <div className="space-y-1">
              {lastTick.results.map((r, i) => {
                const isEntry  = r.includes('ENTRY');
                const isClosed = r.includes('CLOSED');
                const isOpen   = r.includes('OPEN') && !r.includes('outside') && !r.includes('no signal');
                const cls = isEntry ? 'text-emerald-400' : isClosed ? 'text-yellow-400' : isOpen ? 'text-blue-400' : 'text-gray-500';
                return <p key={i} className={`text-xs font-mono ${cls}`}>{r}</p>;
              })}
            </div>
          )}
        </div>

        {/* Today Card */}
        <TodayCard open={open} today={today} />

        {/* Summary cards */}
        {account && account.totalTrades > 0 && (
          <>
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Last 60 Days</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Net P&amp;L</p>
                <p className={`text-xl font-bold ${pnlCls(account.netPnl)}`}>{fmt(account.netPnl)}</p>
                <p className="text-xs text-gray-600 mt-1">
                  {account.roi >= 0 ? '+' : ''}{account.roi.toFixed(2)}% ROI
                </p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className="text-xl font-bold text-white">{account.winRate}%</p>
                <p className="text-xs text-gray-600 mt-1">{account.wins}W / {account.closedTrades - account.wins}L</p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Trades</p>
                <p className="text-xl font-bold text-white">{account.totalTrades}</p>
                <p className="text-xs text-gray-600 mt-1">{account.openTrades} open · {account.closedTrades} closed</p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Avg Win / Loss</p>
                <p className="text-xl font-bold text-white">{fmt(account.avgWin, false)}</p>
                <p className="text-xs text-gray-600 mt-1">
                  Avg W: {fmt(account.avgWin)} &nbsp;|&nbsp; <span className="text-red-400">Avg L: {fmt(account.avgLoss)}</span>
                </p>
              </div>
            </div>
          </>
        )}

        {/* Trade History table */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Trade History ({closed.length} closed)
            </h2>
          </div>
          {trades.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <Clock className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No trades yet</p>
              <p className="text-xs mt-1">The cron engine fires every 5 min during market hours (9:15 AM – 3:00 PM IST)</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300 border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="py-2.5 px-4 text-left">Date</th>
                    <th className="py-2.5 px-3 text-left">Dir</th>
                    <th className="py-2.5 px-3 text-right">Strike</th>
                    <th className="py-2.5 px-3 text-right">Entry ₹</th>
                    <th className="py-2.5 px-3 text-right">Exit ₹</th>
                    <th className="py-2.5 px-3 text-right">Lots</th>
                    <th className="py-2.5 px-3 text-right">VIX</th>
                    <th className="py-2.5 px-3 text-left">Regime</th>
                    <th className="py-2.5 px-3 text-center">Exit</th>
                    <th className="py-2.5 px-4 text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {closed.slice().reverse().map(t => (
                    <tr key={t._id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="py-2 px-4 font-mono">{istDate(t.entryTime)}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          {t.direction === 'CALL'
                            ? <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            : <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                          <span className={t.direction === 'CALL' ? 'text-emerald-400' : 'text-red-400'}>
                            {t.direction}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{t.strike}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.entryPremium}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.exitPremium ?? '—'}</td>
                      <td className="py-2 px-3 text-right">{t.lots}</td>
                      <td className="py-2 px-3 text-right">{t.vix?.toFixed(1)}</td>
                      <td className="py-2 px-3">{regimeBadge(t.regime)}</td>
                      <td className="py-2 px-3 text-center">
                        {t.exitReason ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            t.exitReason === 'TRAIL_SL' ? 'bg-yellow-500/10 text-yellow-400' :
                            t.exitReason === 'SL'       ? 'bg-red-500/10 text-red-400'       :
                            'bg-gray-700 text-gray-400'
                          }`}>{t.exitReason}</span>
                        ) : '—'}
                      </td>
                      <td className={`py-2 px-4 text-right font-mono font-bold ${
                        t.status === 'OPEN' ? 'text-yellow-400' : pnlCls(t.netPnl ?? 0)
                      }`}>
                        {t.status === 'OPEN' ? 'OPEN' : (t.netPnl != null ? fmt(t.netPnl) : '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </AppShell>
  );
}
