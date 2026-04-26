'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import StatCard from '@/components/ui/StatCard';
import { BarChart2, BookOpen, CalendarDays, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';
import { reportsService } from '@/services/reports.service';

type Tab = 'daily' | 'monthly' | 'journal';
type Journal = Awaited<ReturnType<typeof reportsService.getTradeJournal>>;
type Monthly = Awaited<ReturnType<typeof reportsService.getMonthlySummary>>;
type Daily = Awaited<ReturnType<typeof reportsService.getDailyPnl>>;
type Perf = Awaited<ReturnType<typeof reportsService.getPerformanceSummary>>;

function pnlClass(v: number) {
  return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400';
}

function fmt(v: number) {
  return (v >= 0 ? '+' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily');
  const [daily, setDaily] = useState<Daily>([]);
  const [monthly, setMonthly] = useState<Monthly>([]);
  const [journal, setJournal] = useState<Journal>([]);
  const [perf, setPerf] = useState<Perf | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, m, j, p] = await Promise.all([
        reportsService.getDailyPnl(60),
        reportsService.getMonthlySummary(12),
        reportsService.getTradeJournal(100),
        reportsService.getPerformanceSummary(),
      ]);
      setDaily(d);
      setMonthly(m);
      setJournal(j);
      setPerf(p);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const TABS = [
    { key: 'daily' as Tab, label: 'Daily P&L', icon: BarChart2 },
    { key: 'monthly' as Tab, label: 'Monthly Summary', icon: CalendarDays },
    { key: 'journal' as Tab, label: 'Trade Journal', icon: BookOpen },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Reports</h1>
            <p className="text-gray-500 text-sm mt-1">P&L analytics, trade journal, and performance metrics</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Performance summary */}
        {perf && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Total Trades" value={String(perf.totalTrades)} sub={`${perf.wins}W / ${perf.losses}L`} />
            <StatCard
              label="Win Rate"
              value={perf.totalTrades > 0 ? `${perf.winRate}%` : '—'}
              positive={perf.winRate >= 50}
              negative={perf.winRate < 50 && perf.totalTrades > 0}
            />
            <StatCard
              label="Total P&L"
              value={perf.totalTrades > 0 ? fmt(perf.totalPnl) : '—'}
              positive={perf.totalPnl > 0}
              negative={perf.totalPnl < 0}
            />
            <StatCard
              label="Profit Factor"
              value={perf.totalTrades > 0 ? String(perf.profitFactor) : '—'}
              positive={perf.profitFactor >= 1}
              negative={perf.profitFactor < 1 && perf.totalTrades > 0}
            />
          </div>
        )}

        {perf && perf.totalTrades > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard label="Avg Win" value={fmt(perf.avgWin)} positive />
            <StatCard label="Avg Loss" value={fmt(-perf.avgLoss)} negative />
            <StatCard
              label="Best Trade"
              value={perf.bestTrade ? `${perf.bestTrade.symbol} ${fmt(perf.bestTrade.pnl)}` : '—'}
              positive
            />
            <StatCard
              label="Current Streak"
              value={`${perf.currentStreak} ${perf.streakType}`}
              positive={perf.streakType === 'WIN'}
              negative={perf.streakType === 'LOSS'}
            />
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex gap-2 border-b border-gray-700 pb-0">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? 'border-emerald-500 text-emerald-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Daily P&L */}
        {tab === 'daily' && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-300">Daily P&L — Last 60 Days</h2>
            </div>
            {loading ? (
              <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
            ) : daily.length === 0 ? (
              <div className="py-12 text-center text-gray-600 text-sm">No trading data yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Date</th>
                      <th className="text-right px-4 py-3">Realized P&L</th>
                      <th className="text-right px-4 py-3">Trades</th>
                      <th className="text-right px-4 py-3">Wins</th>
                      <th className="text-right px-4 py-3">Losses</th>
                      <th className="text-right px-4 py-3">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {[...daily].reverse().map((d) => {
                      const wr = d.totalTrades > 0 ? ((d.wins / d.totalTrades) * 100).toFixed(0) : null;
                      return (
                        <tr key={d.date} className="hover:bg-gray-700/30 transition-colors">
                          <td className="px-5 py-3 text-gray-300 font-medium">{d.date}</td>
                          <td className={`px-4 py-3 text-right font-medium ${pnlClass(d.realizedPnl)}`}>
                            {fmt(d.realizedPnl)}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-400">{d.totalTrades}</td>
                          <td className="px-4 py-3 text-right text-emerald-400">{d.wins}</td>
                          <td className="px-4 py-3 text-right text-red-400">{d.losses}</td>
                          <td className="px-4 py-3 text-right text-gray-400">{wr != null ? `${wr}%` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Monthly Summary */}
        {tab === 'monthly' && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-300">Monthly Summary — Last 12 Months</h2>
            </div>
            {loading ? (
              <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
            ) : monthly.length === 0 ? (
              <div className="py-12 text-center text-gray-600 text-sm">No monthly data yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Month</th>
                      <th className="text-right px-4 py-3">Realized P&L</th>
                      <th className="text-right px-4 py-3">Trades</th>
                      <th className="text-right px-4 py-3">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {[...monthly].reverse().map((m) => (
                      <tr key={m.month} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-3 text-gray-300 font-medium">{m.month}</td>
                        <td className={`px-4 py-3 text-right font-medium ${pnlClass(m.realizedPnl)}`}>
                          {fmt(m.realizedPnl)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{m.totalTrades}</td>
                        <td className="px-4 py-3 text-right text-gray-400">
                          {m.totalTrades > 0 ? `${m.winRate}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Trade Journal */}
        {tab === 'journal' && (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-300">Trade Journal — Last 100 Closed Trades</h2>
            </div>
            {loading ? (
              <div className="py-12 text-center text-gray-500 text-sm">Loading…</div>
            ) : journal.length === 0 ? (
              <div className="py-12 text-center text-gray-600 text-sm">No closed trades yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-700 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Symbol</th>
                      <th className="text-right px-4 py-3">Qty</th>
                      <th className="text-right px-4 py-3">Entry</th>
                      <th className="text-right px-4 py-3">Exit</th>
                      <th className="text-right px-4 py-3">P&L</th>
                      <th className="text-left px-4 py-3">Result</th>
                      <th className="text-right px-4 py-3">Hold (h)</th>
                      <th className="text-left px-4 py-3">Strategy</th>
                      <th className="text-left px-4 py-3">Closed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {journal.map((t) => (
                      <tr key={t._id} className="hover:bg-gray-700/30 transition-colors">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {t.result === 'WIN' ? (
                              <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            ) : (
                              <TrendingDown className="w-3.5 h-3.5 text-red-400 shrink-0" />
                            )}
                            <span className="font-medium text-white">{t.symbol}</span>
                            <span className="text-xs text-gray-500">{t.exchange}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{t.quantity}</td>
                        <td className="px-4 py-3 text-right text-gray-400">₹{t.entryPrice.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-gray-400">₹{t.exitPrice.toFixed(2)}</td>
                        <td className={`px-4 py-3 text-right font-medium ${pnlClass(t.realizedPnl)}`}>
                          {fmt(t.realizedPnl)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            t.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {t.result}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">
                          {t.holdingHours != null ? t.holdingHours : '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[120px]">{t.strategyName}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                          {t.closedAt ? new Date(t.closedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
