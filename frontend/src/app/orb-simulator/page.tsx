'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { Play, Plus, Trash2, RefreshCw, Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import api from '@/lib/api';
import { fmt, pnlCls } from '@/lib/trade-fmt';
import { TWO_YEARS_AGO, TODAY } from '@/lib/dates';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Combo {
  id: number;
  label: string;
  slPct: number;
  trailTrigger: number;
  trailPct: number;
  smartCooldown: boolean;
  directionBlock: boolean;
  dailyLossLimit: number; // ₹ — 0 = disabled
}

interface Metrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpeRatio: number;
  roi: number;
  finalCapital: number;
  equityCurve: { t: string; e: number }[];
}

interface ComboResult {
  id: number;
  status: 'idle' | 'running' | 'done' | 'error';
  metrics?: Metrics;
  error?: string;
}

// ── Default combos ────────────────────────────────────────────────────────────

const DEFAULT_COMBOS: Combo[] = [
  { id: 1, label: 'Dir Block, no limit',    slPct: 12, trailTrigger: 15, trailPct: 12, smartCooldown: false, directionBlock: true, dailyLossLimit: 0    },
  { id: 2, label: 'Dir Block + ₹2,000 DLL', slPct: 12, trailTrigger: 15, trailPct: 12, smartCooldown: false, directionBlock: true, dailyLossLimit: 2000 },
  { id: 3, label: 'Dir Block + ₹3,000 DLL', slPct: 12, trailTrigger: 15, trailPct: 12, smartCooldown: false, directionBlock: true, dailyLossLimit: 3000 },
  { id: 4, label: 'Dir Block + ₹4,000 DLL', slPct: 12, trailTrigger: 15, trailPct: 12, smartCooldown: false, directionBlock: true, dailyLossLimit: 4000 },
];

const CAPITAL_OPTIONS = [
  { label: '₹20k',  value: 20_000 },
  { label: '₹50k',  value: 50_000 },
  { label: '₹1L',   value: 100_000 },
  { label: '₹2.5L', value: 250_000 },
  { label: '₹5L',   value: 500_000 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number) { return v.toFixed(1) + '%'; }

function score(m: Metrics): number {
  const wrScore  = m.winRate * 0.30;
  const pfScore  = Math.min(m.profitFactor / 15, 1) * 25;
  const shScore  = Math.min(Math.max(m.sharpeRatio, 0) / 5, 1) * 25;
  const roiScore = Math.min(Math.max(m.roi, 0) / 500, 1) * 15;
  const ddScore  = m.maxDrawdown > 0 ? (1 - Math.min(m.maxDrawdown / 50_000, 1)) * 5 : 5;
  return +(wrScore + pfScore + shScore + roiScore + ddScore).toFixed(1);
}

// ── Components ────────────────────────────────────────────────────────────────

function ComboRow({ combo, result, onChange, onDelete, disabled }: {
  combo: Combo;
  result: ComboResult;
  onChange: (c: Combo) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const m = result.metrics;
  return (
    <tr className="border-b border-gray-700 hover:bg-gray-750">
      {/* Label */}
      <td className="py-3 px-3">
        <input value={combo.label} onChange={e => onChange({ ...combo, label: e.target.value })}
          className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-28 border border-gray-600" />
      </td>
      {/* SL % */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          <input type="number" value={combo.slPct} min={5} max={50} step={1}
            onChange={e => onChange({ ...combo, slPct: +e.target.value })}
            className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-16 border border-gray-600 text-center" />
          <span className="text-gray-500 text-xs">%</span>
        </div>
      </td>
      {/* Trail trigger */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          <input type="number" value={combo.trailTrigger} min={5} max={100} step={5}
            onChange={e => onChange({ ...combo, trailTrigger: +e.target.value })}
            className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-16 border border-gray-600 text-center" />
          <span className="text-gray-500 text-xs">%</span>
        </div>
      </td>
      {/* Trail % */}
      <td className="py-3 px-3">
        <div className="flex items-center gap-1">
          <input type="number" value={combo.trailPct} min={5} max={50} step={1}
            onChange={e => onChange({ ...combo, trailPct: +e.target.value })}
            className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-16 border border-gray-600 text-center" />
          <span className="text-gray-500 text-xs">%</span>
        </div>
      </td>
      {/* Results */}
      {/* Smart Cooldown toggle */}
      <td className="py-3 px-2 text-center">
        <input type="checkbox" checked={combo.smartCooldown}
          onChange={e => onChange({ ...combo, smartCooldown: e.target.checked })}
          className="accent-emerald-500 w-4 h-4 cursor-pointer" />
      </td>
      {/* Direction Block toggle */}
      <td className="py-3 px-2 text-center">
        <input type="checkbox" checked={combo.directionBlock}
          onChange={e => onChange({ ...combo, directionBlock: e.target.checked })}
          className="accent-purple-500 w-4 h-4 cursor-pointer" />
      </td>
      {/* Daily Loss Limit */}
      <td className="py-3 px-3">
        <input type="number" value={combo.dailyLossLimit} min={0} step={500}
          onChange={e => onChange({ ...combo, dailyLossLimit: +e.target.value })}
          placeholder="0=off"
          className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-20 border border-gray-600 text-center" />
      </td>
      {result.status === 'idle'    && <td colSpan={7} className="py-3 px-3 text-gray-600 text-sm">—</td>}
      {result.status === 'running' && <td colSpan={7} className="py-3 px-3"><RefreshCw size={14} className="animate-spin text-yellow-400" /></td>}
      {result.status === 'error'   && <td colSpan={7} className="py-3 px-3 text-red-400 text-xs">{result.error}</td>}
      {result.status === 'done' && m && <>
        <td className="py-3 px-3 text-sm text-gray-300">{m.totalTrades}</td>
        <td className={`py-3 px-3 text-sm font-medium ${m.winRate >= 65 ? 'text-emerald-400' : m.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{pct(m.winRate)}</td>
        <td className={`py-3 px-3 text-sm font-medium ${pnlCls(m.netPnl)}`}>{fmt(m.netPnl)}</td>
        <td className="py-3 px-3 text-sm text-gray-300">{m.profitFactor.toFixed(1)}</td>
        <td className="py-3 px-3 text-sm text-gray-300">{m.sharpeRatio.toFixed(2)}</td>
        <td className="py-3 px-3 text-sm text-red-400">₹{m.maxDrawdown.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
        <td className={`py-3 px-3 text-sm font-bold ${pnlCls(m.roi)}`}>{pct(m.roi)}</td>
      </>}
      {/* Delete */}
      <td className="py-3 px-2">
        <button onClick={onDelete} disabled={disabled}
          className="p-1 text-gray-600 hover:text-red-400 disabled:opacity-30">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OrbSimulatorPage() {
  const [fromDate, setFromDate] = useState(TWO_YEARS_AGO);
  const [toDate,   setToDate]   = useState(TODAY);
  const [capital,  setCapital]  = useState(20_000);
  const [combos,   setCombos]   = useState<Combo[]>(DEFAULT_COMBOS);
  const [results,  setResults]  = useState<Record<number, ComboResult>>(() =>
    Object.fromEntries(DEFAULT_COMBOS.map(c => [c.id, { id: c.id, status: 'idle' as const }]))
  );
  const [running,  setRunning]  = useState(false);
  const [nextId,   setNextId]   = useState(5);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const updateCombo = (updated: Combo) => setCombos(cs => cs.map(c => c.id === updated.id ? updated : c));
  const deleteCombo = (id: number) => {
    setCombos(cs => cs.filter(c => c.id !== id));
    setResults(r => { const n = { ...r }; delete n[id]; return n; });
  };
  const addCombo = () => {
    const id = nextId;
    const last = combos[combos.length - 1] ?? DEFAULT_COMBOS[3];
    setCombos(cs => [...cs, { id, label: `Combo ${id}`, slPct: last.slPct, trailTrigger: last.trailTrigger, trailPct: last.trailPct, smartCooldown: last.smartCooldown, directionBlock: last.directionBlock, dailyLossLimit: last.dailyLossLimit }]);
    setResults(r => ({ ...r, [id]: { id, status: 'idle' } }));
    setNextId(n => n + 1);
  };

  const runAll = async () => {
    setRunning(true);
    // Mark all running
    setResults(r => Object.fromEntries(combos.map(c => [c.id, { id: c.id, status: 'running' as const }])));

    await Promise.allSettled(combos.map(async combo => {
      try {
        const { data } = await api.post('/orb-simulator/run', {
          fromDate, toDate, capital,
          slPct:          combo.slPct / 100,
          trailTrigger:   combo.trailTrigger / 100,
          trailPct:       combo.trailPct / 100,
          smartCooldown:  combo.smartCooldown,
          directionBlock: combo.directionBlock,
          dailyLossLimit: combo.dailyLossLimit,
        });
        setResults(r => ({ ...r, [combo.id]: { id: combo.id, status: 'done', metrics: data.metrics } }));
      } catch (e: unknown) {
        setResults(r => ({ ...r, [combo.id]: { id: combo.id, status: 'error', error: e instanceof Error ? e.message : String(e) } }));
      }
    }));
    setRunning(false);
  };

  const doneResults = combos
    .filter(c => results[c.id]?.status === 'done' && results[c.id]?.metrics)
    .map(c => ({ combo: c, metrics: results[c.id].metrics! }));

  // Best combo by composite score
  const scored = doneResults.map(r => ({ ...r, score: score(r.metrics) }));
  const best = scored.length ? scored.reduce((a, b) => b.score > a.score ? b : a) : null;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Play size={22} className="text-purple-400" />
          <div>
            <h1 className="text-xl font-bold text-white">A — Breakout Rider · SL Simulator</h1>
            <p className="text-sm text-gray-400">Run multiple SL combos on the same data — find the best parameters</p>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-gray-800 rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-400 block mb-1">From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600" />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">Capital</label>
            <select value={capital} onChange={e => setCapital(+e.target.value)}
              className="bg-gray-700 text-white rounded px-3 py-1.5 text-sm border border-gray-600">
              {CAPITAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <button onClick={runAll} disabled={running || combos.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded text-sm font-semibold ml-auto">
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? `Running ${combos.length} combos…` : `Run All (${combos.length})`}
          </button>
        </div>

        {/* Winner banner */}
        {best && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
            <Trophy size={20} className="text-yellow-400 shrink-0" />
            <div>
              <p className="text-yellow-300 font-semibold text-sm">
                Best combo: <span className="text-white">{best.combo.label}</span>
                <span className="ml-2 text-gray-400 font-normal">
                  SL {best.combo.slPct}% · Trail after +{best.combo.trailTrigger}% · Trail {best.combo.trailPct}%
                </span>
              </p>
              <p className="text-yellow-400/70 text-xs mt-0.5">
                Score {best.score} · {pct(best.metrics.winRate)} WR · PF {best.metrics.profitFactor.toFixed(1)} · {fmt(best.metrics.netPnl)} net
              </p>
            </div>
          </div>
        )}

        {/* Combo table */}
        <div className="bg-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-700">
                <th className="py-3 px-3">Label</th>
                <th className="py-3 px-3">Fixed SL</th>
                <th className="py-3 px-3">Trail After</th>
                <th className="py-3 px-3">Trail %</th>
                <th className="py-3 px-2 text-center" title="Cooldown only after fixed SL, not after TRAIL_SL/EOD">Smart CD</th>
                <th className="py-3 px-2 text-center" title="Block same direction after SL hit">Dir Block</th>
                <th className="py-3 px-3" title="Hard stop across all instruments once day loss hits this">Daily Loss ₹</th>
                <th className="py-3 px-3">Trades</th>
                <th className="py-3 px-3">Win Rate</th>
                <th className="py-3 px-3">Net P&L</th>
                <th className="py-3 px-3">Prof Factor</th>
                <th className="py-3 px-3">Sharpe</th>
                <th className="py-3 px-3">Max DD</th>
                <th className="py-3 px-3">ROI</th>
                <th className="py-3 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {combos.map(combo => (
                <ComboRow key={combo.id} combo={combo} result={results[combo.id] ?? { id: combo.id, status: 'idle' }}
                  onChange={updateCombo} onDelete={() => deleteCombo(combo.id)} disabled={running} />
              ))}
            </tbody>
          </table>

          <div className="px-3 py-2 border-t border-gray-700">
            <button onClick={addCombo} disabled={running}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-40">
              <Plus size={14} /> Add combo
            </button>
          </div>
        </div>

        {/* Score bar chart */}
        {scored.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">
              Composite Score
              <span className="text-xs text-gray-500 ml-2">Win Rate 30% + PF 25% + Sharpe 25% + ROI 15% + DD 5%</span>
            </h2>
            <div className="space-y-2">
              {[...scored].sort((a, b) => b.score - a.score).map((r, rank) => {
                const maxScore = Math.max(...scored.map(s => s.score));
                const pctW = maxScore > 0 ? (r.score / maxScore) * 100 : 0;
                const isBest = r.combo.id === best?.combo.id;
                return (
                  <div key={r.combo.id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-4 text-right">{rank + 1}.</span>
                    <span className="text-xs text-gray-300 w-40 truncate">{r.combo.label}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-4">
                      <div className={`h-4 rounded-full ${isBest ? 'bg-yellow-500' : 'bg-purple-600'}`} style={{ width: `${pctW}%` }} />
                    </div>
                    <span className="text-sm font-bold text-white w-10 text-right">{r.score}</span>
                    {isBest && <Trophy size={14} className="text-yellow-400" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Equity curves */}
        {doneResults.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Equity Curves</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {doneResults.map(r => (
                <button key={r.combo.id}
                  onClick={() => setExpandedId(expandedId === r.combo.id ? null : r.combo.id)}
                  className={`text-xs px-2 py-0.5 rounded transition-colors ${expandedId === r.combo.id ? 'bg-purple-700 text-white' : 'bg-gray-700 text-gray-400'}`}>
                  {r.combo.label}
                  {expandedId === r.combo.id ? <ChevronUp size={10} className="inline ml-1" /> : <ChevronDown size={10} className="inline ml-1" />}
                </button>
              ))}
            </div>
            {expandedId !== null && results[expandedId]?.metrics?.equityCurve && (
              <EquityChart data={results[expandedId].metrics!.equityCurve} initialCapital={capital} />
            )}
            {expandedId === null && (
              <p className="text-xs text-gray-600 py-4 text-center">Click a combo above to view its equity curve</p>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}
