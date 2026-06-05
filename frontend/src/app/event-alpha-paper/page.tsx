'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { Activity, RefreshCw, Zap, Clock } from 'lucide-react';
import { eventAlphaPaperService } from '@/services/event-alpha-paper.service';
import type { EATrade, Summary, LastTick } from '@/services/event-alpha-paper.service';
import { fmt, pnlCls, exitReasonCls, statusBadge, isEngineActive, TICK_STATUS_CLS } from '@/lib/trade-fmt';

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventTypeBadge(et?: string) {
  if (!et) return null;
  const cls =
    et.includes('VIX') && et.includes('GAP') ? 'bg-red-500/10 text-red-400' :
    et.includes('VIX') ? 'bg-yellow-500/10 text-yellow-400'                  :
    'bg-blue-500/10 text-blue-400';
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{et}</span>;
}

// ── Today Card ────────────────────────────────────────────────────────────────

function TodayCard({ trade }: { trade: EATrade | null }) {
  if (!trade) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 px-5 py-6">
        <p className="text-gray-500 text-sm">No trade today yet — engine fires at 9:20 AM IST on event days (VIX &gt; 18 or gap &gt; 1.2%)</p>
      </div>
    );
  }

  const borderCls =
    trade.status === 'OPEN'                               ? 'border-yellow-500/40' :
    trade.status === 'CLOSED' && (trade.netPnl ?? 0) > 0 ? 'border-emerald-500/30' :
    trade.status === 'CLOSED'                             ? 'border-red-500/20' :
    'border-gray-700';

  return (
    <div className={`bg-gray-800 rounded-xl border ${borderCls} px-5 py-5`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold text-base">Today — {trade.date}</h3>
          {eventTypeBadge(trade.eventType)}
        </div>
        <span className={statusBadge(trade.status)}>{trade.status}</span>
      </div>

      {trade.status === 'SKIPPED' && (
        <p className="text-gray-500 text-sm">Skipped: {trade.skipReason}</p>
      )}

      {(trade.status === 'OPEN' || trade.status === 'CLOSED') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500 mb-1">Spot</p>
            <p className="text-white font-mono font-bold">{trade.spot?.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Strike</p>
            <p className="text-white font-mono font-bold">{trade.strike}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Entry Straddle</p>
            <p className="text-white font-mono font-bold">₹{trade.entryStraddle}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Lots</p>
            <p className="text-white font-mono font-bold">{trade.lots} × 65</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">VIX</p>
            <p className={`font-mono ${(trade.vix ?? 0) > 18 ? 'text-red-400' : 'text-white'}`}>{trade.vix}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Gap</p>
            <p className={`font-mono ${Math.abs(trade.gapPct ?? 0) > 1.2 ? 'text-yellow-400' : 'text-white'}`}>
              {trade.gapPct?.toFixed(2)}%
            </p>
          </div>

          {trade.status === 'OPEN' && (
            <>
              <div>
                <p className="text-xs text-gray-500 mb-1">Current Straddle</p>
                <p className="text-yellow-300 font-mono font-bold">₹{trade.currentStraddle}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Live P&amp;L</p>
                <p className={`font-mono font-bold ${pnlCls(trade.currentPnl ?? 0)}`}>
                  {(trade.currentPnl ?? 0) >= 0 ? '+' : ''}₹{trade.currentPnl?.toLocaleString()}
                </p>
              </div>
            </>
          )}

          {trade.status === 'CLOSED' && (
            <>
              <div>
                <p className="text-xs text-gray-500 mb-1">Exit Straddle</p>
                <p className="text-white font-mono font-bold">₹{trade.exitStraddle}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Net P&amp;L</p>
                <p className={`font-mono font-bold text-lg ${pnlCls(trade.netPnl ?? 0)}`}>
                  {fmt(trade.netPnl ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Exit</p>
                <p className={`font-mono font-bold ${exitReasonCls(trade.exitReason)}`}>{trade.exitReason}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function EventAlphaPaperPage() {
  const [today,    setToday]    = useState<EATrade | null>(null);
  const [recent,   setRecent]   = useState<EATrade[]>([]);
  const [summary,  setSummary]  = useState<Summary | null>(null);
  const [lastTick, setLastTick] = useState<LastTick | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [forcing,  setForcing]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, r, s, lt] = await Promise.all([
        eventAlphaPaperService.today().catch(() => null),
        eventAlphaPaperService.recent(60),
        eventAlphaPaperService.summary(60),
        eventAlphaPaperService.lastTick().catch(() => null),
      ]);
      setToday(t);
      setRecent(r);
      setSummary(s);
      if (lt) setLastTick(lt);
    } catch (err) { console.error('[EventAlphaPaper load]', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const handleForceTick = useCallback(async () => {
    setForcing(true);
    try {
      const lt = await eventAlphaPaperService.forceTick();
      if (lt) setLastTick(lt);
      setTimeout(load, 1500);
    } finally {
      setForcing(false);
    }
  }, [load]);

  const closed = recent.filter(t => t.status === 'CLOSED');

  const active = isEngineActive(lastTick, 'status', 845, 1430);

  return (
    <AppShell mainClassName={active ? 'bg-emerald-950/40' : 'bg-gray-950/60'}>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">C — Storm Chaser</h1>
            <p className="text-gray-500 text-sm mt-1">
              Buy ATM straddle at 9:20 AM · Event days only (VIX &gt; 18 or gap &gt; 1.2%) · TP 100% · SL 50% · Exit 2:30 PM
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
              title="Manually trigger one tick (for testing)"
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
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-gray-300">Last Cron Tick</span>
            {lastTick && (
              <span className="text-xs text-gray-600">
                {new Date(lastTick.time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
              </span>
            )}
          </div>
          {!lastTick ? (
            <p className="text-xs text-gray-600">No tick recorded yet — engine fires every 5 min during market hours (9:15 AM – 2:35 PM IST)</p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-semibold ${TICK_STATUS_CLS[lastTick.status] ?? 'text-gray-400'}`}>
                  {lastTick.status}
                </span>
              </div>
              <p className="text-gray-300 text-sm font-mono">{lastTick.message}</p>
              {lastTick.trade && (
                <div className="bg-gray-800 rounded-lg p-3 grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-gray-500">Entry:</span> <span className="text-white font-mono">₹{lastTick.trade.entryStraddle.toFixed(1)}</span></div>
                  <div><span className="text-gray-500">Current:</span> <span className="text-yellow-300 font-mono">₹{lastTick.trade.currentStraddle.toFixed(1)}</span></div>
                  <div><span className="text-gray-500">P&amp;L:</span> <span className={`font-mono font-bold ${pnlCls(lastTick.trade.pnl)}`}>{lastTick.trade.pnl >= 0 ? '+' : ''}₹{lastTick.trade.pnl}</span></div>
                  <div><span className="text-gray-500">Spot:</span> <span className="text-white font-mono">{lastTick.trade.spot.toLocaleString()}</span></div>
                  <div><span className="text-gray-500">Strike:</span> <span className="text-white font-mono">{lastTick.trade.strike}</span></div>
                  <div><span className="text-gray-500">Move:</span> <span className={`font-mono ${lastTick.trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{lastTick.trade.pnlPct.toFixed(1)}%</span></div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Today Card */}
        <TodayCard trade={today} />

        {/* Summary cards */}
        {summary && summary.total > 0 && (
          <>
            <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider">Last 60 Days</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Net P&amp;L</p>
                <p className={`text-xl font-bold ${pnlCls(summary.netPnl)}`}>
                  {fmt(summary.netPnl)}
                </p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                <p className="text-xl font-bold text-white">{summary.winRate}%</p>
                <p className="text-xs text-gray-600 mt-1">{summary.wins}W / {summary.losses}L</p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Trades</p>
                <p className="text-xl font-bold text-white">{summary.total}</p>
                <p className="text-xs text-gray-600 mt-1">{summary.skipped} skipped</p>
              </div>
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                <p className="text-xs text-gray-500 mb-1">Profit Factor</p>
                <p className="text-xl font-bold text-white">{summary.profitFactor}</p>
                <p className="text-xs text-gray-600 mt-1">
                  Avg W: {fmt(summary.avgWin)} &nbsp;|&nbsp; <span className="text-red-400">Avg L: {fmt(summary.avgLoss)}</span>
                </p>
              </div>
            </div>
          </>
        )}

        {/* Trade Log table */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Trade History ({closed.length} closed)
            </h2>
          </div>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <Clock className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No trades yet</p>
              <p className="text-xs mt-1">The cron engine fires every 5 min on event days, 9:15 AM – 2:35 PM IST</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300 border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="py-2.5 px-4 text-left">Date</th>
                    <th className="py-2.5 px-3 text-left">Event</th>
                    <th className="py-2.5 px-3 text-right">Entry ₹</th>
                    <th className="py-2.5 px-3 text-right">Exit ₹</th>
                    <th className="py-2.5 px-3 text-right">Lots</th>
                    <th className="py-2.5 px-3 text-right">VIX</th>
                    <th className="py-2.5 px-3 text-right">Gap%</th>
                    <th className="py-2.5 px-3 text-center">Exit</th>
                    <th className="py-2.5 px-4 text-right">Net P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {recent.map((t) => (
                    <tr key={t.date} className="hover:bg-gray-700/30 transition-colors">
                      <td className="py-2 px-4 font-mono">{t.date}</td>
                      <td className="py-2 px-3">
                        {t.eventType ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            t.eventType.includes('VIX') && t.eventType.includes('GAP') ? 'bg-red-500/10 text-red-400' :
                            t.eventType.includes('VIX') ? 'bg-yellow-500/10 text-yellow-400' :
                            'bg-blue-500/10 text-blue-400'
                          }`}>{t.eventType}</span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{t.entryStraddle ?? '—'}</td>
                      <td className="py-2 px-3 text-right font-mono">{t.exitStraddle ?? '—'}</td>
                      <td className="py-2 px-3 text-right">{t.lots ?? '—'}</td>
                      <td className="py-2 px-3 text-right">{t.vix ?? '—'}</td>
                      <td className="py-2 px-3 text-right">
                        {t.gapPct != null ? (
                          <span className={Math.abs(t.gapPct) > 1.2 ? 'text-yellow-400' : ''}>
                            {t.gapPct > 0 ? '+' : ''}{t.gapPct}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-3 text-center">
                        {t.exitReason ? (
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${exitReasonCls(t.exitReason)}`}>{t.exitReason}</span>
                        ) : (
                          <span className="text-gray-600">
                            {t.status === 'SKIPPED' ? (t.skipReason?.slice(0, 14) + '…') : '—'}
                          </span>
                        )}
                      </td>
                      <td className={`py-2 px-4 text-right font-mono font-bold ${
                        t.status === 'SKIPPED' ? 'text-gray-600' :
                        t.status === 'OPEN'    ? 'text-yellow-400' :
                        pnlCls(t.netPnl ?? 0)
                      }`}>
                        {t.status === 'SKIPPED' ? 'SKIP' :
                         t.status === 'OPEN'
                           ? (t.currentPnl != null ? `${t.currentPnl >= 0 ? '+' : ''}₹${t.currentPnl}` : 'OPEN')
                           : (t.netPnl != null ? fmt(t.netPnl) : '—')}
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
