'use client';

import { useState, useEffect } from 'react';
import AppShell from '@/components/layout/AppShell';
import InstrumentSearch from '@/components/ui/InstrumentSearch';
import EquityChart from '@/components/charts/EquityChart';
import MetricsGrid from '@/components/charts/MetricsGrid';
import Badge from '@/components/ui/Badge';
import { FlaskConical, Plus, Download, Play, Trash2, X } from 'lucide-react';
import { marketDataService, CandleInterval } from '@/services/market-data.service';
import { backtestService, type BacktestRunFull } from '@/services/backtest.service';
import { strategiesService } from '@/services/strategies.service';
import type { Strategy } from '@/types';

const INTERVALS: CandleInterval[] = ['minute', '5minute', '15minute', '30minute', '60minute', 'day', 'week'];

interface FetchResult { symbol: string; fetched: number; stored: number; error?: string }

export default function BacktestsPage() {
  // Data fetch panel
  const [selected, setSelected] = useState<{ symbol: string; exchange: string } | null>(null);
  const [interval, setInterval] = useState<CandleInterval>('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<FetchResult | null>(null);
  const [fetchError, setFetchError] = useState('');

  // Backtest run modal
  const [showModal, setShowModal] = useState(false);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');
  const [btFromDate, setBtFromDate] = useState('');
  const [btToDate, setBtToDate] = useState('');
  const [inSampleRatio, setInSampleRatio] = useState(0.7);
  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState('');

  // Backtest runs list & detail view
  const [runs, setRuns] = useState<BacktestRunFull[]>([]);
  const [selectedRun, setSelectedRun] = useState<BacktestRunFull | null>(null);

  // Fetch strategies on mount
  useEffect(() => {
    (async () => {
      try {
        const strats = await strategiesService.list();
        setStrategies(strats);
      } catch (err) {
        console.error('Failed to load strategies');
      }
    })();
  }, []);

  // Fetch backtest runs on mount
  useEffect(() => {
    backtestService.list().then((newRuns: BacktestRunFull[]) => {
      setRuns(newRuns);
    }).catch(() => {
      console.error('Failed to load backtest runs');
    });
  }, []);

  // Poll for updates every 2s, only refresh selectedRun if status/data changed
  useEffect(() => {
    const reloadRuns = () => {
      backtestService.list().then((newRuns: BacktestRunFull[]) => {
        setRuns(newRuns);
        setSelectedRun((prev: BacktestRunFull | null) => {
          if (!prev) return null;
          const updated = newRuns.find((r) => r._id === prev._id);
          if (!updated) return prev;
          // Only update if status changed to avoid unnecessary re-renders
          return updated.status !== prev.status ? updated : prev;
        });
      }).catch((error: unknown) => {
        console.error('Failed to reload backtest runs', error);
      });
    };
    const handle: NodeJS.Timeout = global.setInterval(reloadRuns, 2000);
    return () => global.clearInterval(handle);
  }, []);

  async function handleFetch() {
    if (!selected || !from || !to) { setFetchError('Select an instrument and date range'); return; }
    setFetching(true); setFetchError(''); setResult(null);
    try {
      const res = await marketDataService.fetchCandles(selected.symbol, selected.exchange, interval, from, to);
      setResult({ symbol: selected.symbol, ...res });
    } catch (err: any) {
      setFetchError(err.response?.data?.message ?? 'Fetch failed');
    } finally {
      setFetching(false);
    }
  }

  async function handleRunBacktest() {
    if (!selectedStrategy || !btFromDate || !btToDate) {
      setRunError('Select strategy and date range');
      return;
    }
    setRunLoading(true);
    setRunError('');
    try {
      const newRun = await backtestService.run({
        strategyId: selectedStrategy,
        fromDate: btFromDate,
        toDate: btToDate,
        inSampleRatio,
      });
      setRuns((prev) => [newRun, ...prev]);
      setShowModal(false);
      setSelectedRun(newRun);
      setBtFromDate('');
      setBtToDate('');
      setSelectedStrategy('');
    } catch (err: any) {
      setRunError(err.response?.data?.message ?? 'Run failed');
    } finally {
      setRunLoading(false);
    }
  }

  async function handleDeleteRun(id: string) {
    if (!confirm('Delete this backtest run?')) return;
    try {
      await backtestService.delete(id);
      setRuns((prev) => prev.filter((r) => r._id !== id));
      if (selectedRun?._id === id) setSelectedRun(null);
    } catch (err) {
      console.error('Delete failed');
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Backtests</h1>
            <p className="text-gray-500 text-sm mt-1">Historical simulation and walk-forward analysis</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Run Backtest
          </button>
        </div>

        {/* Data Fetch Panel */}
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Download className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-gray-300">Fetch Historical Data</h2>
            <span className="text-xs text-gray-600">(Requires broker connected in Settings)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Instrument</label>
              <InstrumentSearch
                onSelect={(inst) => setSelected({ symbol: inst.symbol, exchange: inst.exchange })}
                placeholder="e.g. RELIANCE, NIFTY 50…"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Interval</label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value as CandleInterval)}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                {INTERVALS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="block text-xs text-gray-500">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="block text-xs text-gray-500">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <button
              onClick={handleFetch}
              disabled={fetching}
              className="mt-auto flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              {fetching ? 'Fetching…' : 'Fetch & Store'}
            </button>
          </div>

          {fetchError && <p className="mt-3 text-sm text-red-400">{fetchError}</p>}
          {result && (
            <div className="mt-3 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
              {result.symbol}: fetched {result.fetched} candles, stored {result.stored} new/updated.
            </div>
          )}
        </div>

        {/* Backtest Runs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-gray-800 rounded-xl border border-gray-700">
              <div className="px-5 py-4 border-b border-gray-700">
                <h2 className="text-sm font-semibold text-gray-300">Backtest Runs</h2>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {runs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-gray-600 px-4">
                    <FlaskConical className="w-8 h-8 mb-2 opacity-40" />
                    <p className="text-sm">No runs yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-700">
                    {runs.map((run) => (
                      <button
                        key={run._id}
                        onClick={() => setSelectedRun(run)}
                        className={`w-full px-4 py-3 text-left text-xs hover:bg-gray-700/50 transition-colors ${
                          selectedRun?._id === run._id ? 'bg-gray-700/50 border-l-2 border-emerald-400' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-300 truncate font-medium">
                              {strategies.find((s) => s._id === run.strategyId)?.name ?? 'Unknown'}
                            </p>
                            <p className="text-gray-500 text-xs mt-1">{run.fromDate} → {run.toDate}</p>
                          </div>
                          <Badge
                            variant={
                              run.status === 'COMPLETED' ? 'green' : run.status === 'FAILED' ? 'red' : 'yellow'
                            }
                          >
                            {run.status === 'QUEUED' ? 'Queue' : run.status === 'RUNNING' ? 'Run' : run.status === 'COMPLETED' ? 'Done' : 'Fail'}
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Results View */}
          <div className="lg:col-span-2">
            {selectedRun ? (
              <div className="space-y-4">
                {selectedRun.status === 'RUNNING' && (
                  <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                    <p className="text-xs text-yellow-600">Simulation in progress…</p>
                  </div>
                )}

                {selectedRun.status === 'FAILED' && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
                    <p className="text-xs text-red-400 font-medium">Error</p>
                    <p className="text-xs text-red-300 mt-1">{selectedRun.errorMessage || 'Unknown error'}</p>
                  </div>
                )}

                {selectedRun.status === 'COMPLETED' && selectedRun.metrics && (
                  <>
                    {/* Equity Curve */}
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                      <h3 className="text-sm font-semibold text-gray-300 mb-4">Equity Curve</h3>
                      <EquityChart
                        data={selectedRun.metrics.equityCurve || []}
                        initialCapital={(selectedRun.parameters?.paperCapital as number) || 1_000_000}
                      />
                    </div>

                    {/* Overall Metrics */}
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                      <MetricsGrid metrics={selectedRun.metrics} label="Overall" />
                    </div>

                    {/* In-Sample vs Out-of-Sample */}
                    {selectedRun.metrics.inSampleMetrics && (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                          <MetricsGrid metrics={selectedRun.metrics.inSampleMetrics} label="In-Sample (Training)" />
                        </div>
                        <div className="bg-gray-800 rounded-xl border border-gray-700 p-5">
                          <MetricsGrid metrics={selectedRun.metrics.outOfSampleMetrics!} label="Out-of-Sample (Test)" />
                        </div>
                      </div>
                    )}

                    {/* Trades Table */}
                    {selectedRun.trades && selectedRun.trades.length > 0 && (
                      <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                        <div className="px-5 py-4 border-b border-gray-700">
                          <h3 className="text-sm font-semibold text-gray-300">Trades ({selectedRun.trades.length})</h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-700 bg-gray-700/30">
                                <th className="px-4 py-3 text-left text-gray-400">Symbol</th>
                                <th className="px-4 py-3 text-left text-gray-400">Entry</th>
                                <th className="px-4 py-3 text-left text-gray-400">Exit</th>
                                <th className="px-4 py-3 text-right text-gray-400">P&L</th>
                                <th className="px-4 py-3 text-center text-gray-400">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedRun.trades.slice(0, 20).map((t, i) => (
                                <tr key={i} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                                  <td className="px-4 py-2">{t.symbol}</td>
                                  <td className="px-4 py-2">{new Date(t.entryTime).toLocaleDateString()}</td>
                                  <td className="px-4 py-2">{new Date(t.exitTime).toLocaleDateString()}</td>
                                  <td className={`px-4 py-2 text-right font-medium ${t.netPnl > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {t.netPnl > 0 ? '+' : ''}₹{t.netPnl.toFixed(0)}
                                  </td>
                                  <td className="px-4 py-2 text-center text-gray-400">{t.exitReason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {selectedRun.trades.length > 20 && (
                          <div className="px-4 py-2 text-center text-xs text-gray-500 border-t border-gray-700">
                            +{selectedRun.trades.length - 20} more trades
                          </div>
                        )}
                      </div>
                    )}

                    {/* Delete Button */}
                    <button
                      onClick={() => handleDeleteRun(selectedRun._id)}
                      className="w-full flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg transition-colors border border-red-500/20"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Run
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="bg-gray-800 rounded-xl border border-gray-700 flex flex-col items-center justify-center py-20 text-gray-600">
                <FlaskConical className="w-10 h-10 mb-3 opacity-40" />
                <p className="text-sm">Select a backtest run to view results</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-5">
          <p className="text-xs text-yellow-600 leading-relaxed">
            <strong className="text-yellow-400">Validation reminder:</strong> Walk-forward testing splits data by time (default 70% in-sample, 30% out-of-sample). Compare both periods — out-of-sample performance is the true test of strategy robustness.
          </p>
        </div>
      </div>

      {/* Run Backtest Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">Run Backtest</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-300">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-2">Strategy</label>
                <select
                  value={selectedStrategy}
                  onChange={(e) => setSelectedStrategy(e.target.value)}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Select strategy…</option>
                  {strategies.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-2">From Date</label>
                  <input
                    type="date"
                    value={btFromDate}
                    onChange={(e) => setBtFromDate(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-2">To Date</label>
                  <input
                    type="date"
                    value={btToDate}
                    onChange={(e) => setBtToDate(e.target.value)}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-2">In-Sample Ratio</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0.1"
                    max="0.95"
                    step="0.05"
                    value={inSampleRatio}
                    onChange={(e) => setInSampleRatio(parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm text-gray-300 w-12">{(inSampleRatio * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Train {(inSampleRatio * 100).toFixed(0)}%, test {((1 - inSampleRatio) * 100).toFixed(0)}%</p>
              </div>

              {runError && <p className="text-sm text-red-400">{runError}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRunBacktest}
                  disabled={runLoading}
                  className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors"
                >
                  <Play className="w-4 h-4" />
                  {runLoading ? 'Running…' : 'Run'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
