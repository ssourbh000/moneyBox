'use client';

import { useState, useEffect, useCallback } from 'react';
import AppShell from '@/components/layout/AppShell';
import Badge from '@/components/ui/Badge';
import { ListOrdered, RefreshCw } from 'lucide-react';
import { ordersService } from '@/services/orders.service';

type Order = Awaited<ReturnType<typeof ordersService.getOrders>>[number];
type Filter = 'All' | 'OPEN' | 'COMPLETE' | 'CANCELLED' | 'REJECTED';

const STATUS_VARIANT: Record<string, 'green' | 'red' | 'blue' | 'gray' | 'yellow'> = {
  COMPLETE: 'green',
  OPEN: 'blue',
  PENDING: 'yellow',
  CANCELLED: 'gray',
  REJECTED: 'red',
};

function fmt(n?: number) {
  if (n == null) return '—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('All');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ordersService.getOrders({ limit: 200 });
      setOrders(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = filter === 'All' ? orders : orders.filter((o) => o.status === filter);

  const counts = {
    All: orders.length,
    OPEN: orders.filter((o) => o.status === 'OPEN').length,
    COMPLETE: orders.filter((o) => o.status === 'COMPLETE').length,
    CANCELLED: orders.filter((o) => o.status === 'CANCELLED').length,
    REJECTED: orders.filter((o) => o.status === 'REJECTED').length,
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Orders</h1>
            <p className="text-gray-500 text-sm mt-1">Order history and execution status</p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center gap-2 flex-wrap">
            {(['All', 'OPEN', 'COMPLETE', 'CANCELLED', 'REJECTED'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-colors ${
                  filter === f
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700'
                }`}
              >
                {f === 'All' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}{' '}
                <span className="opacity-70">({counts[f]})</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-500 text-sm">Loading…</div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <ListOrdered className="w-10 h-10 mb-3 opacity-30" />
              <p className="text-sm">No orders found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-500 text-xs uppercase tracking-wide">
                    <th className="text-left px-5 py-3">Symbol</th>
                    <th className="text-left px-4 py-3">Side</th>
                    <th className="text-left px-4 py-3">Type</th>
                    <th className="text-right px-4 py-3">Qty</th>
                    <th className="text-right px-4 py-3">Price</th>
                    <th className="text-right px-4 py-3">Avg Fill</th>
                    <th className="text-left px-4 py-3">Status</th>
                    <th className="text-left px-4 py-3">Mode</th>
                    <th className="text-left px-4 py-3">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {visible.map((o) => (
                    <tr key={o._id} className="hover:bg-gray-700/30 transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-medium text-white">{o.symbol}</span>
                        <span className="ml-1 text-xs text-gray-500">{o.exchange}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium text-xs ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                          {o.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{o.orderType}</td>
                      <td className="px-4 py-3 text-right text-gray-200">
                        {o.filledQuantity}/{o.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">{fmt(o.price)}</td>
                      <td className="px-4 py-3 text-right text-gray-200">{fmt(o.averagePrice)}</td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANT[o.status] ?? 'gray'}>{o.status}</Badge>
                        {o.rejectionReason && (
                          <p className="text-xs text-red-400 mt-0.5">{o.rejectionReason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={o.mode === 'paper' ? 'blue' : 'green'}>{o.mode}</Badge>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(o.createdAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
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
