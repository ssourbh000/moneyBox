'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { Bitcoin, TrendingUp, TrendingDown, RefreshCw, Zap, Activity } from 'lucide-react';
import { cryptoOrbService, CryptoTrade, CryptoAccount } from '@/services/crypto-orb.service';

function usd(v: number, sign = true) {
  const prefix = sign ? (v >= 0 ? '+$' : '-$') : '$';
  return prefix + Math.abs(v).toFixed(4);
}
function pct(v: number) { return (v >= 0 ? '+' : '') + v.toFixed(2) + '%'; }
function pnlCls(v: number) {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}
function utcTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit' }) + ' UTC';
}
function utcDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: '2-digit' });
}

const SYMBOL_COLORS: Record<string, string> = {
  BTCUSDT: 'text-yellow-400',
  ETHUSDT: 'text-blue-400',
};
const SYMBOL_LABELS: Record<string, string> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
};

export default function CryptoOrbPage() {
  const [account, setAccount]   = useState<CryptoAccount | null>(null);
  const [trades, setTrades]     = useState<CryptoTrade[]>([]);
  const [loading, setLoading]   = useState(true);
  const [ticking, setTicking]   = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [acc, recent] = await Promise.all([
        cryptoOrbService.account(),
        cryptoOrbService.recent(90),
      ]);
      setAccount(acc);
      setTrades(recent);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 5 min
  useEffect(() => {
    const id = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [load]);

  const handleForceTick = async () => {
    setTicking(true);
    try {
      await cryptoOrbService.forceTick();
      setTimeout(load, 2000); // reload after 2s to pick up new trade
    } finally {
      setTicking(false);
    }
  };

  const open   = trades.filter(t => t.status === 'OPEN');
  const closed = trades.filter(t => t.status === 'CLOSED');

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Bitcoin className="w-6 h-6 text-yellow-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Crypto ORB Paper Trading</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Strategy B v4 · BTC &amp; ETH · 24/7 · $200 USDT paper · UTC sessions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {lastRefresh && <span className="text-xs text-gray-600">Refreshed {lastRefresh}</span>}
            <button
              onClick={handleForceTick}
              disabled={ticking}
              title="Manually trigger one tick (for testing outside cron schedule)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
            >
              <Zap className={`w-3.5 h-3.5 ${ticking ? 'animate-pulse' : ''}`} />
              Force Tick
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

        {/* How it works banner */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-5 py-3 flex flex-wrap gap-6 text-xs text-gray-500">
          <span><span className="text-gray-300 font-medium">Session</span> — UTC calendar day (00:00–23:00)</span>
          <span><span className="text-gray-300 font-medium">ORB</span> — first 9 bars × 5 min = 45-min opening range</span>
          <span><span className="text-gray-300 font-medium">Entry window</span> — 00:45–20:00 UTC (20 hrs/day)</span>
          <span><span className="text-gray-300 font-medium">Data</span> — Binance public API, no auth</span>
          <span><span className="text-gray-300 font-medium">Cron</span> — every 5 min, 24/7</span>
        </div>

        {/* Account cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Account Equity</p>
            <p className={`text-xl font-bold ${account ? pnlCls(account.netPnl) : 'text-white'}`}>
              {account ? `$${account.equity.toFixed(4)}` : '—'}
            </p>
            <p className={`text-xs mt-1 ${account ? pnlCls(account.roi) : 'text-gray-500'}`}>
              {account ? `${pct(account.roi)} ROI` : ''}
            </p>
          </div>
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
            <p className="text-xs text-gray-500 mb-1">Net P&amp;L (USDT)</p>
            <p className={`text-xl font-bold ${account ? pnlCls(account.netPnl) : 'text-white'}`}>
              {account ? usd(account.netPnl) : '—'}
            </p>
            <p className="text-xs text-gray-600 mt-1">Starting: $200</p>
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

        {/* Open positions */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-300">Open Positions</h2>
            {open.length > 0 && (
              <span className="text-xs bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">
                {open.length}
              </span>
            )}
          </div>
          {open.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-gray-600">
              <Activity className="w-7 h-7 mb-2 opacity-30" />
              <p className="text-sm">No open position — engine scanning every 5 min</p>
            </div>
          ) : (
            open.map(t => (
              <div key={t._id} className="px-5 py-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    {t.direction === 'LONG'
                      ? <TrendingUp className="w-5 h-5 text-emerald-400" />
                      : <TrendingDown className="w-5 h-5 text-red-400" />}
                    <div>
                      <span className={`font-bold text-lg ${SYMBOL_COLORS[t.symbol] ?? 'text-white'}`}>
                        {SYMBOL_LABELS[t.symbol] ?? t.symbol}
                      </span>
                      <span className={`ml-2 text-sm font-medium ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.direction}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div><p className="text-gray-500 text-xs">Entry</p><p className="text-white">${t.entryPrice.toLocaleString()}</p></div>
                    <div><p className="text-gray-500 text-xs">SL</p><p className="text-red-400">${t.slPrice.toLocaleString()}</p></div>
                    <div><p className="text-gray-500 text-xs">Peak</p><p className="text-emerald-400">${(t.peakPrice ?? t.entryPrice).toLocaleString()}</p></div>
                    <div><p className="text-gray-500 text-xs">Qty</p><p className="text-white">{t.quantity}</p></div>
                    <div><p className="text-gray-500 text-xs">Entry time</p><p className="text-white">{utcTime(t.entryTime)}</p></div>
                  </div>
                </div>
                {t.meta && (
                  <div className="flex gap-4 text-xs text-gray-600">
                    <span>ORB H/L ${t.meta.orbHigh}/${t.meta.orbLow}</span>
                    <span>VWAP ${t.meta.vwap}</span>
                    <span>EMA9/21 ${t.meta.ema9}/${t.meta.ema21}</span>
                    <span>RSI {t.meta.rsi}</span>
                    <span>ADX {t.meta.adx}</span>
                  </div>
                )}
                {t.trailSL && (
                  <p className="text-xs text-yellow-400">Trailing SL active</p>
                )}
              </div>
            ))
          )}
        </div>

        {/* Trade history */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">
              Trade History ({closed.length})
            </h2>
            {account && account.closedTrades > 0 && (
              <span className="text-xs text-gray-500">
                Avg W: <span className="text-emerald-400">{usd(account.avgWin)}</span>
                &nbsp;·&nbsp;
                Avg L: <span className="text-red-400">{usd(account.avgLoss)}</span>
              </span>
            )}
          </div>
          {closed.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-gray-600">
              <Activity className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No closed trades yet</p>
              <p className="text-xs mt-1">
                Use <span className="text-yellow-400">Force Tick</span> to manually trigger a signal check
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="px-5 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Dir</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-right">Entry $</th>
                    <th className="px-3 py-2 text-right">Exit $</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-right">Equity after</th>
                    <th className="px-5 py-2 text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {[...closed].reverse().map(t => {
                    const pnl = t.netPnlUsdt ?? 0;
                    const reasonCls =
                      t.exitReason === 'TRAIL_SL' ? 'text-yellow-400' :
                      t.exitReason === 'SL'        ? 'text-red-400'    :
                      t.exitReason === 'EOD'        ? 'text-gray-400'   : 'text-gray-500';
                    return (
                      <tr key={t._id} className="hover:bg-gray-700/30">
                        <td className={`px-5 py-2.5 font-medium ${SYMBOL_COLORS[t.symbol] ?? 'text-white'}`}>
                          {SYMBOL_LABELS[t.symbol] ?? t.symbol}
                        </td>
                        <td className={`px-3 py-2.5 font-medium ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {t.direction}
                        </td>
                        <td className="px-3 py-2.5 text-gray-400">
                          {utcDate(t.entryTime)}
                          <span className="block text-gray-600">{utcTime(t.entryTime)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-300">
                          {t.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-300">
                          {t.exitPrice?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400">{t.quantity}</td>
                        <td className={`px-3 py-2.5 ${reasonCls}`}>{t.exitReason ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right text-gray-500">
                          {t.capitalAfter != null ? `$${t.capitalAfter.toFixed(2)}` : '—'}
                        </td>
                        <td className={`px-5 py-2.5 text-right font-medium ${pnlCls(pnl)}`}>
                          {usd(pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
