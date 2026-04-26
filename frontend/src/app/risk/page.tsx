'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import { ShieldAlert, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { riskService } from '@/services/risk.service';
import { strategiesService } from '@/services/strategies.service';

type RiskEvent = Awaited<ReturnType<typeof riskService.getEvents>>[number];

const EVENT_COLORS: Record<string, string> = {
  KILL_SWITCH: 'text-red-400',
  MAX_DAILY_LOSS: 'text-orange-400',
  MAX_POSITIONS: 'text-yellow-400',
  MAX_EXPOSURE: 'text-yellow-400',
  STALE_DATA: 'text-blue-400',
  BROKER_ERROR: 'text-red-400',
};

export default function RiskPage() {
  const [killActive, setKillActive] = useState(false);
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [strategy, setStrategy] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [status, evts, strats] = await Promise.all([
        riskService.getStatus(),
        riskService.getEvents(),
        strategiesService.list(),
      ]);
      setKillActive(status.killSwitchActive);
      setEvents(evts);
      setStrategy(strats[0] ?? null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleKillSwitch() {
    setToggling(true);
    try {
      if (killActive) {
        await riskService.deactivateKillSwitch();
        setKillActive(false);
      } else {
        await riskService.activateKillSwitch();
        setKillActive(true);
      }
      await load();
    } finally {
      setToggling(false);
    }
  }

  const limits = strategy?.riskLimits ?? {};

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Risk Controls</h1>
            <p className="text-gray-500 text-sm mt-1">Global safeguards and kill switch</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Kill Switch */}
        <div className={`border rounded-xl p-6 ${killActive ? 'bg-red-500/10 border-red-500/40' : 'bg-gray-800 border-gray-700'}`}>
          <div className="flex items-start gap-4">
            <div className={`p-2 rounded-lg mt-0.5 ${killActive ? 'bg-red-500/20' : 'bg-gray-700'}`}>
              {killActive ? (
                <ShieldAlert className="w-5 h-5 text-red-400" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h3 className={`text-base font-semibold ${killActive ? 'text-red-400' : 'text-white'}`}>
                  Kill Switch
                </h3>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${killActive ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                  {killActive ? 'ACTIVE — Trading Halted' : 'Inactive'}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {killActive
                  ? 'All new orders are blocked. Deactivate to resume trading.'
                  : 'Immediately halts all new orders across all strategies. Use in emergencies only.'}
              </p>
              <button
                onClick={toggleKillSwitch}
                disabled={toggling}
                className={`mt-4 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                  killActive
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                {toggling ? 'Processing…' : killActive ? 'Deactivate Kill Switch' : 'Activate Kill Switch'}
              </button>
            </div>
          </div>
        </div>

        {/* Risk Limits from strategy */}
        <div>
          <h2 className="text-sm font-semibold text-gray-400 mb-3">
            Active Risk Limits
            {strategy && <span className="ml-2 text-gray-600 font-normal">({strategy.name})</span>}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              {
                label: 'Max Daily Loss',
                value: limits.maxDailyLoss != null ? `₹${Number(limits.maxDailyLoss).toLocaleString('en-IN')}` : 'Not set',
                desc: 'Halt all trading when daily realized loss hits this limit',
              },
              {
                label: 'Max Open Positions',
                value: limits.maxOpenPositions != null ? String(limits.maxOpenPositions) : 'Not set',
                desc: 'Maximum simultaneous open positions allowed per strategy',
              },
              {
                label: 'Max Position Size',
                value: limits.maxPositionSize != null ? `₹${Number(limits.maxPositionSize).toLocaleString('en-IN')}` : 'Not set',
                desc: 'Capital cap per single trade',
              },
              {
                label: 'Risk Per Trade',
                value: limits.riskPercentPerTrade != null ? `${limits.riskPercentPerTrade}%` : 'Not set',
                desc: 'Maximum % of capital risked on a single entry',
              },
            ].map(({ label, value, desc }) => (
              <div key={label} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-300">{label}</span>
                  <span className={`text-sm font-mono font-medium ${value === 'Not set' ? 'text-gray-600' : 'text-emerald-400'}`}>
                    {value}
                  </span>
                </div>
                <p className="text-xs text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Events */}
        <div className="bg-gray-800 rounded-xl border border-gray-700">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <h2 className="text-sm font-semibold text-gray-300">Risk Events</h2>
            {events.length > 0 && (
              <span className="ml-auto text-xs text-gray-500">{events.length} events</span>
            )}
          </div>
          {loading ? (
            <div className="py-8 text-center text-gray-500 text-sm">Loading…</div>
          ) : events.length === 0 ? (
            <div className="py-8 text-center text-gray-600 text-sm">No risk events recorded</div>
          ) : (
            <div className="divide-y divide-gray-700/50">
              {events.map((e) => (
                <div key={e._id} className="px-5 py-3 flex items-start gap-3">
                  <span className={`text-xs font-semibold mt-0.5 ${EVENT_COLORS[e.eventType] ?? 'text-gray-400'}`}>
                    {e.eventType.replace(/_/g, ' ')}
                  </span>
                  <span className="flex-1 text-sm text-gray-400">{e.message}</span>
                  {e.halted && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full shrink-0">Halted</span>
                  )}
                  <span className="text-xs text-gray-600 shrink-0">
                    {new Date(e.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
