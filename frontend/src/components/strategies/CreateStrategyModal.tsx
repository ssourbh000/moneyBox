'use client';

import { useState, FormEvent } from 'react';
import { strategiesService } from '@/services/strategies.service';
import { X } from 'lucide-react';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

const PRESET_UNIVERSES: Record<string, string[]> = {
  'Nifty 50 — Top 10 liquid': ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'HINDUNILVR', 'BAJFINANCE', 'SBIN', 'BHARTIARTL', 'KOTAKBANK'],
  'Nifty IT': ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'LTIM', 'MPHASIS', 'COFORGE'],
  'Nifty Bank': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'INDUSINDBK', 'BANDHANBNK'],
};

export default function CreateStrategyModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [exchange, setExchange] = useState('NSE');
  const [universeText, setUniverseText] = useState('');
  const [maxDailyLoss, setMaxDailyLoss] = useState('5000');
  const [maxPositions, setMaxPositions] = useState('3');
  const [paperCapital, setPaperCapital] = useState('1000000');
  const [riskPct, setRiskPct] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function applyPreset(key: string) {
    setUniverseText(PRESET_UNIVERSES[key].join(', '));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const universe = universeText.split(',').map((s) => s.trim()).filter(Boolean);
    if (!universe.length) { setError('Add at least one symbol'); return; }

    setLoading(true);
    try {
      await strategiesService.create({
        name,
        description,
        exchange,
        universe,
        riskLimits: {
          maxDailyLoss: parseFloat(maxDailyLoss),
          maxOpenPositions: parseInt(maxPositions, 10),
          paperCapital: parseFloat(paperCapital),
          riskPercentPerTrade: parseFloat(riskPct),
        },
      } as any);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message ?? 'Failed to create strategy');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <h2 className="text-base font-semibold text-white">New Strategy</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {error && <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs text-gray-400 mb-1">Strategy Name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="e.g. Nifty Trend Continuation" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description (optional)</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
              placeholder="Brief description" />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Exchange</label>
            <select value={exchange} onChange={(e) => setExchange(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500">
              <option value="NSE">NSE</option>
              <option value="BSE">BSE</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-gray-400">Symbol Universe (comma-separated)</label>
              <div className="flex gap-1">
                {Object.keys(PRESET_UNIVERSES).map((k) => (
                  <button key={k} type="button" onClick={() => applyPreset(k)}
                    className="text-xs text-emerald-400 hover:underline">{k.split(' — ')[0]}</button>
                ))}
              </div>
            </div>
            <textarea required value={universeText} onChange={(e) => setUniverseText(e.target.value)} rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-emerald-500 transition-colors resize-none"
              placeholder="RELIANCE, TCS, HDFCBANK, INFY, ..." />
            <p className="text-xs text-gray-600 mt-1">Must match instrument symbols exactly as they appear in your instrument sync</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Paper Capital (₹)</label>
              <input type="number" value={paperCapital} onChange={(e) => setPaperCapital(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Risk per Trade (%)</label>
              <input type="number" step="0.1" min="0.1" max="5" value={riskPct} onChange={(e) => setRiskPct(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Daily Loss (₹)</label>
              <input type="number" value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Max Open Positions</label>
              <input type="number" min="1" max="10" value={maxPositions} onChange={(e) => setMaxPositions(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-3 text-xs text-gray-500 leading-relaxed">
            <span className="text-gray-400 font-medium">Strategy type:</span> Regime-filtered trend continuation
            (daily EMA 50/200 + hourly ADX/RSI structure + 5-min pullback entry with ATR stop, 2:1 R:R).
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium py-2.5 rounded-lg transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 text-sm font-semibold py-2.5 rounded-lg transition-colors">
              {loading ? 'Creating…' : 'Create Strategy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
