'use client';

import { useState } from 'react';
import AppShell from '@/components/layout/AppShell';
import EquityChart from '@/components/charts/EquityChart';
import { Play, Plus, Trash2, RefreshCw, Trophy, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import api from '@/lib/api';
import { fmt, pnlCls } from '@/lib/trade-fmt';
import { TWO_YEARS_AGO, TODAY } from '@/lib/dates';
import type { EquityPoint } from '@/services/backtest.service';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AParams {
  slPct: number;           // UI: 12  → API: 0.12
  trailTrigger: number;    // UI: 15  → API: 0.15
  trailPct: number;        // UI: 12  → API: 0.12
  directionBlock: boolean;
  dailyLossLimit: number;  // ₹ — 0 = disabled
}

interface BParams {
  tpPct: number;       // UI: 15  → API: 0.15
  slPct: number;       // UI: 30  → API: 0.30
  gapFilter: number;   // UI: 0.8 → API: 0.008
}

interface CParams {
  tpMult: number;      // 2.0 as-is
  slMult: number;      // 0.5 as-is
  vixThresh: number;   // 18 as-is
  gapThresh: number;   // UI: 1.2 → API: 0.012
}

interface Combo {
  id: number;
  label: string;
  a: boolean;
  b: boolean;
  c: boolean;
  aParams: AParams;
  bParams: BParams;
  cParams: CParams;
}

interface StrategyMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  roi: number;
  finalCapital: number;
  equityCurve?: EquityPoint[];
  trades?: Array<{ exitTime: string; pnl: number }>;
}

interface ComboResultData {
  a?: StrategyMetrics;
  b?: StrategyMetrics;
  c?: StrategyMetrics;
}

interface CombinedMetrics {
  totalTrades: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  roi: number;
  finalCapital: number;
  equityCurve: EquityPoint[];
}

interface ComboResult {
  id: number;
  status: 'idle' | 'running' | 'done' | 'error';
  data?: ComboResultData;
  combined?: CombinedMetrics;
  error?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CAPITAL_OPTIONS = [
  { label: '₹20k',  value: 20_000 },
  { label: '₹50k',  value: 50_000 },
  { label: '₹1L',   value: 100_000 },
  { label: '₹2.5L', value: 250_000 },
  { label: '₹5L',   value: 500_000 },
];

const DEFAULT_A: AParams = { slPct: 12, trailTrigger: 15, trailPct: 12, directionBlock: true, dailyLossLimit: 2000 };
const DEFAULT_B: BParams = { tpPct: 15, slPct: 30, gapFilter: 0.8 };
const DEFAULT_C: CParams = { tpMult: 2.0, slMult: 0.5, vixThresh: 18, gapThresh: 1.2 };

const DEFAULT_COMBOS: Combo[] = [
  { id: 1, label: 'A only (current)',  a: true,  b: false, c: false, aParams: { ...DEFAULT_A }, bParams: { ...DEFAULT_B }, cParams: { ...DEFAULT_C } },
  { id: 2, label: 'B only (30% SL)',   a: false, b: true,  c: false, aParams: { ...DEFAULT_A }, bParams: { tpPct: 15, slPct: 30, gapFilter: 0.8 }, cParams: { ...DEFAULT_C } },
  { id: 3, label: 'B only (20% SL)',   a: false, b: true,  c: false, aParams: { ...DEFAULT_A }, bParams: { tpPct: 15, slPct: 20, gapFilter: 0.8 }, cParams: { ...DEFAULT_C } },
  { id: 4, label: 'A + B combined',    a: true,  b: true,  c: false, aParams: { ...DEFAULT_A }, bParams: { tpPct: 15, slPct: 30, gapFilter: 0.8 }, cParams: { ...DEFAULT_C } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v: number) { return v.toFixed(1) + '%'; }

/** Compute combined metrics from raw per-strategy results */
function computeCombined(data: ComboResultData, capital: number): CombinedMetrics {
  // Collect all trades from each selected strategy, tagged with exitTime
  const allTrades: Array<{ exitTime: string; pnl: number }> = [];

  for (const m of [data.a, data.b, data.c]) {
    if (!m) continue;
    if (m.trades) {
      allTrades.push(...m.trades);
    } else if (m.equityCurve) {
      // Synthesise trades from equity curve deltas if trades not provided
      for (let i = 1; i < m.equityCurve.length; i++) {
        const delta = m.equityCurve[i].e - m.equityCurve[i - 1].e;
        if (delta !== 0) {
          allTrades.push({ exitTime: m.equityCurve[i].t, pnl: delta });
        }
      }
    }
  }

  allTrades.sort((a, b) => a.exitTime.localeCompare(b.exitTime));

  const totalTrades = allTrades.length;
  const wins = allTrades.filter(t => t.pnl > 0).length;
  const losses = allTrades.filter(t => t.pnl < 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netPnl = allTrades.reduce((s, t) => s + t.pnl, 0);

  const grossWin  = allTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(allTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : grossWin > 0 ? 99 : 0;

  // Equity curve
  let equity = capital;
  const equityCurve: EquityPoint[] = [{ t: allTrades[0]?.exitTime.slice(0, 10) ?? '', e: capital }];
  let peak = capital;
  let maxDD = 0;
  for (const trade of allTrades) {
    equity += trade.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ t: trade.exitTime.slice(0, 10), e: equity });
  }

  // Approximate Sharpe from daily P&L
  const dailyMap: Record<string, number> = {};
  for (const t of allTrades) {
    const day = t.exitTime.slice(0, 10);
    dailyMap[day] = (dailyMap[day] ?? 0) + t.pnl;
  }
  const dailyPnls = Object.values(dailyMap);
  let sharpe = 0;
  if (dailyPnls.length > 1) {
    const mean = dailyPnls.reduce((s, v) => s + v, 0) / dailyPnls.length;
    const std = Math.sqrt(dailyPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyPnls.length);
    sharpe = std > 0 ? +((mean / std) * Math.sqrt(252)).toFixed(2) : 0;
  }

  const roi = +((netPnl / capital) * 100).toFixed(1);
  const finalCapital = capital + netPnl;

  return { totalTrades, winRate: +winRate.toFixed(1), netPnl, profitFactor, maxDrawdown: maxDD, sharpeRatio: sharpe, roi, finalCapital, equityCurve };
}

function score(m: CombinedMetrics): number {
  const wrScore  = m.winRate * 0.30;
  const pfScore  = Math.min(m.profitFactor / 15, 1) * 25;
  const shScore  = Math.min(Math.max(m.sharpeRatio, 0) / 5, 1) * 25;
  const roiScore = Math.min(Math.max(m.roi, 0) / 500, 1) * 15;
  const ddScore  = m.maxDrawdown > 0 ? (1 - Math.min(m.maxDrawdown / 50_000, 1)) * 5 : 5;
  return +(wrScore + pfScore + shScore + roiScore + ddScore).toFixed(1);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, color = 'emerald' }: { checked: boolean; onChange: (v: boolean) => void; color?: string }) {
  const bg = checked
    ? color === 'purple' ? 'bg-purple-600' : 'bg-emerald-600'
    : 'bg-gray-600';
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${bg}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  );
}

function NumInput({ value, onChange, min, max, step, suffix, width = 'w-16' }: {
  value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; suffix?: string; width?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={value}
        min={min} max={max} step={step}
        onChange={e => onChange(+e.target.value)}
        className={`bg-gray-700 text-white text-xs rounded px-2 py-1 ${width} border border-gray-600 text-center`}
      />
      {suffix && <span className="text-gray-500 text-xs">{suffix}</span>}
    </div>
  );
}

function AParamsPanel({ params, onChange }: { params: AParams; onChange: (p: AParams) => void }) {
  return (
    <div className="mt-2 p-3 bg-gray-900/60 rounded-lg border border-purple-800/40 space-y-2">
      <p className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">A — Breakout Rider</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">SL %</span>
          <NumInput value={params.slPct} onChange={v => onChange({ ...params, slPct: v })} min={1} max={50} step={1} suffix="%" />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">Trail After %</span>
          <NumInput value={params.trailTrigger} onChange={v => onChange({ ...params, trailTrigger: v })} min={1} max={100} step={1} suffix="%" />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">Trail %</span>
          <NumInput value={params.trailPct} onChange={v => onChange({ ...params, trailPct: v })} min={1} max={50} step={1} suffix="%" />
        </label>
        <label className="block col-span-1">
          <span className="text-[10px] text-gray-500 block mb-1">Dir Block</span>
          <ToggleSwitch checked={params.directionBlock} onChange={v => onChange({ ...params, directionBlock: v })} color="purple" />
        </label>
        <label className="block col-span-2">
          <span className="text-[10px] text-gray-500 block mb-0.5">Daily Loss ₹ (0=off)</span>
          <NumInput value={params.dailyLossLimit} onChange={v => onChange({ ...params, dailyLossLimit: v })} min={0} step={500} suffix="₹" width="w-20" />
        </label>
      </div>
    </div>
  );
}

function BParamsPanel({ params, onChange }: { params: BParams; onChange: (p: BParams) => void }) {
  return (
    <div className="mt-2 p-3 bg-gray-900/60 rounded-lg border border-blue-800/40 space-y-2">
      <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">B — First Light Fade</p>
      <div className="grid grid-cols-3 gap-2">
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">TP %</span>
          <NumInput value={params.tpPct} onChange={v => onChange({ ...params, tpPct: v })} min={1} max={100} step={1} suffix="%" />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">SL %</span>
          <NumInput value={params.slPct} onChange={v => onChange({ ...params, slPct: v })} min={1} max={100} step={1} suffix="%" />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">Gap Filter %</span>
          <NumInput value={params.gapFilter} onChange={v => onChange({ ...params, gapFilter: v })} min={0} max={5} step={0.1} suffix="%" width="w-16" />
        </label>
      </div>
    </div>
  );
}

function CParamsPanel({ params, onChange }: { params: CParams; onChange: (p: CParams) => void }) {
  return (
    <div className="mt-2 p-3 bg-gray-900/60 rounded-lg border border-yellow-800/40 space-y-2">
      <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider">C — Storm Chaser</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">TP×</span>
          <NumInput value={params.tpMult} onChange={v => onChange({ ...params, tpMult: v })} min={0.5} max={10} step={0.5} />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">SL×</span>
          <NumInput value={params.slMult} onChange={v => onChange({ ...params, slMult: v })} min={0.1} max={5} step={0.1} />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">VIX Thresh</span>
          <NumInput value={params.vixThresh} onChange={v => onChange({ ...params, vixThresh: v })} min={10} max={50} step={1} />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-500 block mb-0.5">Gap Thresh %</span>
          <NumInput value={params.gapThresh} onChange={v => onChange({ ...params, gapThresh: v })} min={0} max={5} step={0.1} suffix="%" width="w-16" />
        </label>
      </div>
    </div>
  );
}

function StrategyCheckbox({ letter, active, color, onToggle }: { letter: string; active: boolean; color: string; onToggle: () => void }) {
  const colorMap: Record<string, string> = {
    purple: active ? 'bg-purple-600 border-purple-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-500',
    blue:   active ? 'bg-blue-600 border-blue-500 text-white'   : 'bg-gray-700 border-gray-600 text-gray-500',
    yellow: active ? 'bg-yellow-600 border-yellow-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-500',
  };
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center justify-center w-7 h-7 rounded border text-xs font-bold transition-colors ${colorMap[color]}`}
    >
      {letter}
    </button>
  );
}

function ComboCard({ combo, result, capital, onChange, onDelete, disabled }: {
  combo: Combo;
  result: ComboResult;
  capital: number;
  onChange: (c: Combo) => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const m = result.combined;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700">
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-3">
        {/* Label */}
        <input
          value={combo.label}
          onChange={e => onChange({ ...combo, label: e.target.value })}
          className="bg-gray-700 text-white text-sm rounded px-2 py-1 w-36 border border-gray-600 shrink-0"
        />

        {/* Strategy toggles */}
        <div className="flex items-center gap-1 shrink-0">
          <StrategyCheckbox letter="A" active={combo.a} color="purple" onToggle={() => onChange({ ...combo, a: !combo.a })} />
          <StrategyCheckbox letter="B" active={combo.b} color="blue"   onToggle={() => onChange({ ...combo, b: !combo.b })} />
          <StrategyCheckbox letter="C" active={combo.c} color="yellow" onToggle={() => onChange({ ...combo, c: !combo.c })} />
        </div>

        {/* Params expand toggle */}
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-700 shrink-0"
        >
          Params {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {/* Results area */}
        <div className="flex-1 min-w-0">
          {result.status === 'idle' && (
            <span className="text-gray-600 text-xs">Not run yet</span>
          )}
          {result.status === 'running' && (
            <div className="flex items-center gap-2">
              <RefreshCw size={13} className="animate-spin text-yellow-400" />
              <span className="text-yellow-400 text-xs">Running…</span>
            </div>
          )}
          {result.status === 'error' && (
            <span className="text-red-400 text-xs truncate">{result.error}</span>
          )}
          {result.status === 'done' && m && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
              <span className="text-gray-500 text-xs">{m.totalTrades} trades</span>
              <span className={`text-xs font-medium ${m.winRate >= 65 ? 'text-emerald-400' : m.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                {pct(m.winRate)} WR
              </span>
              <span className={`text-xs font-bold ${pnlCls(m.netPnl)}`}>{fmt(m.netPnl)}</span>
              <span className="text-gray-400 text-xs">PF {m.profitFactor.toFixed(1)}</span>
              <span className="text-gray-400 text-xs">Sharpe {m.sharpeRatio.toFixed(2)}</span>
              <span className="text-red-400 text-xs">DD ₹{m.maxDrawdown.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              <span className={`text-xs font-bold ${pnlCls(m.roi)}`}>{pct(m.roi)} ROI</span>
            </div>
          )}
        </div>

        {/* Delete */}
        <button onClick={onDelete} disabled={disabled} className="p-1 text-gray-600 hover:text-red-400 disabled:opacity-30 shrink-0">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Collapsible params */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-gray-700 pt-3">
          {combo.a && <AParamsPanel params={combo.aParams} onChange={p => onChange({ ...combo, aParams: p })} />}
          {combo.b && <BParamsPanel params={combo.bParams} onChange={p => onChange({ ...combo, bParams: p })} />}
          {combo.c && <CParamsPanel params={combo.cParams} onChange={p => onChange({ ...combo, cParams: p })} />}
          {!combo.a && !combo.b && !combo.c && (
            <p className="text-xs text-gray-600 py-2">Select at least one strategy (A, B, or C) above.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UnifiedSimulatorPage() {
  const [fromDate,   setFromDate]   = useState(TWO_YEARS_AGO);
  const [toDate,     setToDate]     = useState(TODAY);
  const [capital,    setCapital]    = useState(100_000);
  const [combos,     setCombos]     = useState<Combo[]>(DEFAULT_COMBOS);
  const [results,    setResults]    = useState<Record<number, ComboResult>>(() =>
    Object.fromEntries(DEFAULT_COMBOS.map(c => [c.id, { id: c.id, status: 'idle' as const }]))
  );
  const [running,    setRunning]    = useState(false);
  const [nextId,     setNextId]     = useState(5);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const updateCombo = (updated: Combo) => setCombos(cs => cs.map(c => c.id === updated.id ? updated : c));
  const deleteCombo = (id: number) => {
    setCombos(cs => cs.filter(c => c.id !== id));
    setResults(r => { const n = { ...r }; delete n[id]; return n; });
    if (expandedId === id) setExpandedId(null);
  };
  const addCombo = () => {
    const id = nextId;
    const last = combos[combos.length - 1] ?? DEFAULT_COMBOS[3];
    setCombos(cs => [...cs, {
      id, label: `Combo ${id}`,
      a: last.a, b: last.b, c: last.c,
      aParams: { ...last.aParams },
      bParams: { ...last.bParams },
      cParams: { ...last.cParams },
    }]);
    setResults(r => ({ ...r, [id]: { id, status: 'idle' } }));
    setNextId(n => n + 1);
  };

  const runAll = async () => {
    setRunning(true);
    setResults(r => Object.fromEntries(combos.map(c => [c.id, { id: c.id, status: 'running' as const }])));

    await Promise.allSettled(combos.map(async combo => {
      if (!combo.a && !combo.b && !combo.c) {
        setResults(r => ({ ...r, [combo.id]: { id: combo.id, status: 'error', error: 'No strategy selected' } }));
        return;
      }
      try {
        const strategies: Record<string, unknown> = {};
        if (combo.a) {
          strategies.a = {
            slPct:          combo.aParams.slPct / 100,
            trailTrigger:   combo.aParams.trailTrigger / 100,
            trailPct:       combo.aParams.trailPct / 100,
            directionBlock: combo.aParams.directionBlock,
            dailyLossLimit: combo.aParams.dailyLossLimit,
          };
        }
        if (combo.b) {
          strategies.b = {
            tpPct:     combo.bParams.tpPct / 100,
            slPct:     combo.bParams.slPct / 100,
            gapFilter: combo.bParams.gapFilter / 100,
          };
        }
        if (combo.c) {
          strategies.c = {
            tpMult:    combo.cParams.tpMult,
            slMult:    combo.cParams.slMult,
            vixThresh: combo.cParams.vixThresh,
            gapThresh: combo.cParams.gapThresh / 100,
          };
        }

        const { data } = await api.post('/unified-simulator/run', {
          fromDate, toDate, capital, strategies,
        });

        const combined = computeCombined(data, capital);
        setResults(r => ({ ...r, [combo.id]: { id: combo.id, status: 'done', data, combined } }));
      } catch (e: unknown) {
        setResults(r => ({
          ...r,
          [combo.id]: {
            id: combo.id,
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    }));

    setRunning(false);
  };

  const doneResults = combos
    .filter(c => results[c.id]?.status === 'done' && results[c.id]?.combined)
    .map(c => ({ combo: c, combined: results[c.id].combined! }));

  const scored = doneResults.map(r => ({ ...r, score: score(r.combined) }));
  const best = scored.length ? scored.reduce((a, b) => b.score > a.score ? b : a) : null;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <Layers size={22} className="text-emerald-400" />
          <div>
            <h1 className="text-xl font-bold text-white">Unified Simulator</h1>
            <p className="text-sm text-gray-400">
              Compare strategy combos (A + B + C) across the same date range and capital
            </p>
          </div>
        </div>

        {/* Strategy legend */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-purple-900/60 text-purple-300 border border-purple-800/40 px-2 py-0.5 rounded">A — Breakout Rider</span>
          <span className="bg-blue-900/60 text-blue-300 border border-blue-800/40 px-2 py-0.5 rounded">B — First Light Fade</span>
          <span className="bg-yellow-900/60 text-yellow-300 border border-yellow-800/40 px-2 py-0.5 rounded">C — Storm Chaser</span>
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
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-semibold ml-auto">
            {running ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? `Running ${combos.length} combos…` : `▶ Run All (${combos.length})`}
          </button>
        </div>

        {/* Winner banner */}
        {best && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 flex items-center gap-3">
            <Trophy size={20} className="text-yellow-400 shrink-0" />
            <div>
              <p className="text-yellow-300 font-semibold text-sm">
                Best combo: <span className="text-white">{best.combo.label}</span>
                <span className="ml-2 text-gray-400 font-normal text-xs">
                  {[best.combo.a && 'A', best.combo.b && 'B', best.combo.c && 'C'].filter(Boolean).join(' + ')}
                </span>
              </p>
              <p className="text-yellow-400/70 text-xs mt-0.5">
                Score {best.score} · {pct(best.combined.winRate)} WR · PF {best.combined.profitFactor.toFixed(1)} · {fmt(best.combined.netPnl)} net · Sharpe {best.combined.sharpeRatio.toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {/* Combo cards */}
        <div className="space-y-3">
          {combos.map(combo => (
            <ComboCard
              key={combo.id}
              combo={combo}
              result={results[combo.id] ?? { id: combo.id, status: 'idle' }}
              capital={capital}
              onChange={updateCombo}
              onDelete={() => deleteCombo(combo.id)}
              disabled={running}
            />
          ))}

          <button onClick={addCombo} disabled={running}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-40 px-2 py-1">
            <Plus size={14} /> Add combo
          </button>
        </div>

        {/* Results comparison table */}
        {doneResults.length > 0 && (
          <div className="bg-gray-800 rounded-lg overflow-x-auto">
            <div className="px-4 py-3 border-b border-gray-700">
              <h2 className="text-sm font-semibold text-gray-300">Results Comparison</h2>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="py-2 px-4">Combo</th>
                  <th className="py-2 px-3">Strats</th>
                  <th className="py-2 px-3">Trades</th>
                  <th className="py-2 px-3">Win Rate</th>
                  <th className="py-2 px-3">Net P&L</th>
                  <th className="py-2 px-3">PF</th>
                  <th className="py-2 px-3">Sharpe</th>
                  <th className="py-2 px-3">Max DD</th>
                  <th className="py-2 px-3">ROI</th>
                </tr>
              </thead>
              <tbody>
                {doneResults.map(({ combo, combined }) => {
                  const isBest = best?.combo.id === combo.id;
                  return (
                    <tr key={combo.id} className={`border-b border-gray-700 ${isBest ? 'bg-yellow-500/5' : 'hover:bg-gray-750'}`}>
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          {isBest && <Trophy size={12} className="text-yellow-400 shrink-0" />}
                          <span className={`text-sm ${isBest ? 'text-yellow-300 font-semibold' : 'text-gray-300'}`}>{combo.label}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex gap-0.5">
                          {combo.a && <span className="text-[10px] bg-purple-900 text-purple-300 px-1 rounded">A</span>}
                          {combo.b && <span className="text-[10px] bg-blue-900 text-blue-300 px-1 rounded">B</span>}
                          {combo.c && <span className="text-[10px] bg-yellow-900 text-yellow-300 px-1 rounded">C</span>}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-gray-300">{combined.totalTrades}</td>
                      <td className={`py-2.5 px-3 font-medium ${combined.winRate >= 65 ? 'text-emerald-400' : combined.winRate >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {pct(combined.winRate)}
                      </td>
                      <td className={`py-2.5 px-3 font-medium ${pnlCls(combined.netPnl)}`}>{fmt(combined.netPnl)}</td>
                      <td className="py-2.5 px-3 text-gray-300">{combined.profitFactor.toFixed(1)}</td>
                      <td className="py-2.5 px-3 text-gray-300">{combined.sharpeRatio.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-red-400">₹{combined.maxDrawdown.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                      <td className={`py-2.5 px-3 font-bold ${pnlCls(combined.roi)}`}>{pct(combined.roi)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Composite score bar chart */}
        {scored.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-1">
              Composite Score
            </h2>
            <p className="text-xs text-gray-500 mb-3">Win Rate 30% + PF 25% + Sharpe 25% + ROI 15% + DD 5%</p>
            <div className="space-y-2">
              {[...scored].sort((a, b) => b.score - a.score).map((r, rank) => {
                const maxScore = Math.max(...scored.map(s => s.score));
                const pctW = maxScore > 0 ? (r.score / maxScore) * 100 : 0;
                const isBest = r.combo.id === best?.combo.id;
                return (
                  <div key={r.combo.id} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-4 text-right">{rank + 1}.</span>
                    <span className="text-xs text-gray-300 w-44 truncate">{r.combo.label}</span>
                    <div className="flex-1 bg-gray-700 rounded-full h-4 min-w-0">
                      <div
                        className={`h-4 rounded-full transition-all ${isBest ? 'bg-yellow-500' : 'bg-emerald-600'}`}
                        style={{ width: `${pctW}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-white w-10 text-right">{r.score}</span>
                    {isBest && <Trophy size={14} className="text-yellow-400" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Equity curve viewer */}
        {doneResults.length > 0 && (
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Equity Curve Viewer</h2>
            <div className="flex flex-wrap gap-2 mb-3">
              {doneResults.map(r => (
                <button
                  key={r.combo.id}
                  onClick={() => setExpandedId(expandedId === r.combo.id ? null : r.combo.id)}
                  className={`text-xs px-2.5 py-1 rounded transition-colors border ${
                    expandedId === r.combo.id
                      ? 'bg-emerald-700 border-emerald-600 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {r.combo.label}
                  {expandedId === r.combo.id
                    ? <ChevronUp size={10} className="inline ml-1" />
                    : <ChevronDown size={10} className="inline ml-1" />
                  }
                </button>
              ))}
            </div>
            {expandedId !== null && results[expandedId]?.combined?.equityCurve?.length ? (
              <EquityChart
                data={results[expandedId].combined!.equityCurve}
                initialCapital={capital}
              />
            ) : (
              <p className="text-xs text-gray-600 py-6 text-center">Click a combo above to view its equity curve</p>
            )}
          </div>
        )}

      </div>
    </AppShell>
  );
}
