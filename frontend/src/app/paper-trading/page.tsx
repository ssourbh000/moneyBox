'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { Activity, RefreshCw, TrendingUp, TrendingDown, Clock } from 'lucide-react';
import { liveSignalService } from '@/services/option-backtest.service';

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
  capitalBefore?: number;
  capitalAfter?: number;
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
  equityCurve: { date: string; equity: number }[];
}

function fmt(v: number, showSign = true) {
  const sign = showSign ? (v >= 0 ? '+' : '') : '';
  return sign + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function pct(v: number) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function pnlCls(v: number) {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

function regimeBadge(regime?: string) {
  if (!regime) return null;
  const cls = regime === 'NORMAL'
    ? 'bg-emerald-500/10 text-emerald-400'
    : regime === 'HIGH'
    ? 'bg-yellow-500/10 text-yellow-400'
    : 'bg-red-500/10 text-red-400';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cls}`}>{regime}</span>
  );
}

function istTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
}

function istDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
}

export default function PaperTradingPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, recent] = await Promise.all([
        liveSignalService.account(),
        liveSignalService.recent(365),
      ]);
      setAccount(acc);
      setTrades(recent);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open  = trades.filter(t => t.status === 'OPEN');
  const today = trades.filter(t => {
    const d = new Date(t.entryTime).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    const now = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
    return d === now;
  });
  const closed = trades.filter(t => t.status === 'CLOSED');

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Paper Trading</h1>
            <p className="text-gray-500 text-sm mt-1">Strategy B — 45-min ORB Breakout · ₹20,000 dummy capital</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 font-medium">Paper Mode</span>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Account cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Account Equity</p>
            <p className={`text-xl font-bold ${account ? pnlCls(account.netPnl) : 'text-white'}`}>
              {account ? fmt(account.equity, false) : '—'}
            </p>
            <p className={`text-xs mt-1 ${account ? pnlCls(account.netPnl) : 'text-gray-500'}`}>
              {account ? `${pct(account.roi)} ROI` : ''}
            </p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Net P&amp;L</p>
            <p className={`text-xl font-bold ${account ? pnlCls(account.netPnl) : 'text-white'}`}>
              {account ? fmt(account.netPnl) : '—'}
            </p>
            <p className="text-xs text-gray-600 mt-1">Starting: ₹20,000</p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Win Rate</p>
            <p className="text-xl font-bold text-white">{account ? `${account.winRate}%` : '—'}</p>
            <p className="text-xs text-gray-600 mt-1">
              {account ? `${account.wins}W / ${account.closedTrades - account.wins}L` : ''}
            </p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Trades</p>
            <p className="text-xl font-bold text-white">{account?.totalTrades ?? '—'}</p>
            <p className="text-xs text-gray-600 mt-1">
              {account ? `${account.openTrades} open · ${account.closedTrades} closed` : ''}
            </p>
          </div>
        </div>

        {/* Open position */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700">
            <h2 className="text-sm font-semibold text-gray-300">
              Open Position {open.length > 0 && <span className="ml-2 text-xs bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">{open.length}</span>}
            </h2>
          </div>
          {open.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-600">
              <Clock className="w-7 h-7 mb-2 opacity-30" />
              <p className="text-sm">No open position — waiting for signal</p>
            </div>
          ) : (
            open.map(t => (
              <div key={t._id} className="px-5 py-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    {t.direction === 'CALL'
                      ? <TrendingUp className="w-5 h-5 text-emerald-400" />
                      : <TrendingDown className="w-5 h-5 text-red-400" />}
                    <div>
                      <span className="font-semibold text-white">{t.symbol}</span>
                      <span className="ml-2 text-sm text-gray-400">{t.direction} {t.strike}</span>
                      {regimeBadge(t.regime)}
                    </div>
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div><p className="text-gray-500 text-xs">Entry</p><p className="text-white">₹{t.entryPremium}</p></div>
                    <div><p className="text-gray-500 text-xs">SL</p><p className="text-red-400">₹{t.slPremium}</p></div>
                    <div><p className="text-gray-500 text-xs">Peak</p><p className="text-emerald-400">₹{t.peakPremium ?? t.entryPremium}</p></div>
                    <div><p className="text-gray-500 text-xs">Lots</p><p className="text-white">{t.lots}</p></div>
                    <div><p className="text-gray-500 text-xs">VIX</p><p className="text-white">{t.vix?.toFixed(1)}</p></div>
                    <div><p className="text-gray-500 text-xs">Time</p><p className="text-white">{istTime(t.entryTime)}</p></div>
                  </div>
                </div>
                {t.meta && (
                  <div className="flex gap-4 mt-3 text-xs text-gray-600">
                    <span>ORB H/L {t.meta.orbHigh}/{t.meta.orbLow}</span>
                    <span>VWAP {t.meta.vwap}</span>
                    <span>EMA9/21 {t.meta.ema9}/{t.meta.ema21}</span>
                    <span>RSI {t.meta.rsi}</span>
                    <span>ADX {t.meta.adx}</span>
                    <span>Gap {t.meta.gapDir}</span>
                  </div>
                )}
                {t.trailSL && (
                  <p className="text-xs text-yellow-400 mt-2">Trailing SL active — SL has moved up from initial</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Today's trades */}
        {today.length > 0 && (
          <div className="bg-gray-800 rounded-xl border border-gray-700">
            <div className="px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-300">Today&apos;s Trades</h2>
            </div>
            <div className="divide-y divide-gray-700">
              {today.map(t => (
                <TradeRow key={t._id} t={t} />
              ))}
            </div>
          </div>
        )}

        {/* All trade history */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Trade History ({closed.length} trades)</h2>
            {account && (
              <span className={`text-sm font-medium ${pnlCls(account.avgWin)}`}>
                Avg W: {fmt(account.avgWin)} &nbsp;|&nbsp;
                <span className="text-red-400">Avg L: {fmt(account.avgLoss)}</span>
              </span>
            )}
          </div>
          {closed.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <Activity className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No closed trades yet</p>
              <p className="text-xs mt-1">The cron engine fires every 5 min during market hours (9:15 AM – 3:00 PM IST)</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {closed.slice().reverse().map(t => (
                <TradeRow key={t._id} t={t} showCapital />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function TradeRow({ t, showCapital }: { t: PaperTrade; showCapital?: boolean }) {
  const pnl = t.netPnl ?? 0;
  const exitReasonCls =
    t.exitReason === 'TRAIL_SL' ? 'text-yellow-400' :
    t.exitReason === 'SL'       ? 'text-red-400'    :
    t.exitReason === 'EOD'      ? 'text-gray-400'   : 'text-gray-500';

  return (
    <div className="px-5 py-3 flex items-center gap-4 text-sm">
      <div className="w-5">
        {t.direction === 'CALL'
          ? <TrendingUp className="w-4 h-4 text-emerald-400" />
          : <TrendingDown className="w-4 h-4 text-red-400" />}
      </div>
      <div className="w-24">
        <p className="text-white font-medium text-xs">{t.symbol === 'NIFTY 50' ? 'NIFTY' : 'BANKNIFTY'}</p>
        <p className="text-gray-500 text-xs">{t.direction} {t.strike}</p>
      </div>
      <div className="w-20 text-xs text-gray-400">
        <p>{istDate(t.entryTime)}</p>
        <p>{istTime(t.entryTime)}</p>
      </div>
      <div className="flex gap-3 flex-1 text-xs text-gray-400">
        <span>Entry ₹{t.entryPremium}</span>
        {t.exitPremium != null && <span>Exit ₹{t.exitPremium}</span>}
        <span>×{t.lots} lot</span>
        <span>VIX {t.vix?.toFixed(1)}</span>
      </div>
      {t.exitReason && (
        <span className={`text-xs w-16 ${exitReasonCls}`}>{t.exitReason}</span>
      )}
      {t.regime && (
        <span className={`text-xs w-14 ${t.regime === 'NORMAL' ? 'text-emerald-500' : t.regime === 'HIGH' ? 'text-yellow-500' : 'text-red-500'}`}>
          {t.regime}
        </span>
      )}
      {showCapital && t.capitalAfter != null && (
        <span className="text-xs text-gray-600 w-20">→ ₹{t.capitalAfter.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
      )}
      <div className={`w-20 text-right font-medium ${pnlCls(pnl)}`}>
        {t.status === 'OPEN' ? <span className="text-blue-400 text-xs">OPEN</span> : fmt(pnl)}
      </div>
    </div>
  );
}
