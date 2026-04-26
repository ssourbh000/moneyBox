'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Badge from '@/components/ui/Badge';
import CreateStrategyModal from '@/components/strategies/CreateStrategyModal';
import { Plus, Play, Square, Trash2, TrendingUp, Cpu } from 'lucide-react';
import { strategiesService } from '@/services/strategies.service';
import { Strategy } from '@/types';

const statusVariant = (s: Strategy['status']) =>
  s === 'active' ? 'green' : s === 'paused' ? 'yellow' : 'gray';

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [running, setRunning] = useState(false);
  const [engineMsg, setEngineMsg] = useState('');

  const load = useCallback(() => {
    strategiesService.list().then(setStrategies).catch(console.error).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleStart(id: string) {
    await strategiesService.start(id);
    load();
  }
  async function handleStop(id: string) {
    await strategiesService.stop(id);
    load();
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this strategy?')) return;
    await strategiesService.delete(id);
    load();
  }
  async function handleRunEngine() {
    setRunning(true); setEngineMsg('');
    try {
      const result = await strategiesService.runEngine();
      setEngineMsg(`Cycle complete — ${result.processed} strategy checked, ${result.signals} signal(s) generated.`);
    } catch (err: any) {
      setEngineMsg(err.response?.data?.message ?? 'Engine run failed');
    } finally {
      setRunning(false);
      load();
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Strategies</h1>
            <p className="text-gray-500 text-sm mt-1">Regime-filtered trend continuation — paper mode</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleRunEngine}
              disabled={running}
              className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Cpu className={`w-4 h-4 ${running ? 'animate-pulse' : ''}`} />
              {running ? 'Scanning…' : 'Run Engine Now'}
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Strategy
            </button>
          </div>
        </div>

        {engineMsg && (
          <div className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-300">
            {engineMsg}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500 text-sm">Loading…</div>
        ) : strategies.length === 0 ? (
          <div className="bg-gray-800 rounded-xl border border-gray-700 p-16 flex flex-col items-center text-gray-600">
            <TrendingUp className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-base font-medium">No strategies yet</p>
            <p className="text-sm mt-1">Create one to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {strategies.map((s) => (
              <div key={s._id} className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-white">{s.name}</span>
                      <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
                      <Badge variant="blue">paper</Badge>
                    </div>
                    {s.description && <p className="text-xs text-gray-500 mb-2">{s.description}</p>}
                    <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                      <span>Universe: {s.universe.slice(0, 5).join(', ')}{s.universe.length > 5 ? ` +${s.universe.length - 5}` : ''}</span>
                      <span>Trades: {s.totalTrades}</span>
                      <span>Win rate: {s.totalTrades ? `${s.winRate.toFixed(1)}%` : '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {s.status !== 'active' ? (
                      <button onClick={() => handleStart(s._id)} title="Start"
                        className="p-2 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                        <Play className="w-4 h-4" />
                      </button>
                    ) : (
                      <button onClick={() => handleStop(s._id)} title="Stop"
                        className="p-2 rounded-lg text-yellow-400 hover:bg-yellow-500/10 transition-colors">
                        <Square className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => handleDelete(s._id)} title="Delete"
                      className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 text-xs text-gray-600 leading-relaxed">
          <span className="text-gray-400 font-medium">Engine logic:</span> Runs every 5 min during market hours (9:15–15:30 IST).
          Daily EMA 50/200 regime filter → 60-min ADX + RSI structure → 5-min pullback + volume entry → ATR stop + 2:1 target.
          Reads stored candles from MongoDB — keep data fresh via the Backtests page fetch panel.
        </div>
      </div>

      {showModal && (
        <CreateStrategyModal onClose={() => setShowModal(false)} onCreated={load} />
      )}
    </AppShell>
  );
}
