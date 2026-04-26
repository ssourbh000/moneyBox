'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { marketDataService } from '@/services/market-data.service';

export default function KiteCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Delay to ensure searchParams are available
    const timer = setTimeout(async () => {
      try {
        const requestToken = searchParams?.get('request_token');
        const status = searchParams?.get('status');

        console.log('[Callback] Params:', { requestToken, status });

        if (!requestToken || !status) {
          setError('Missing request_token or status');
          await new Promise(r => setTimeout(r, 2000));
          router.push('/settings?broker=error');
          return;
        }

        console.log('[Callback] Calling API...');
        const result = await marketDataService.handleBrokerCallback(requestToken, status);
        console.log('[Callback] API result:', result);

        await new Promise(r => setTimeout(r, 1000));

        if (result?.success) {
          router.push('/settings?broker=connected');
        } else {
          setError(result?.error || 'Unknown error');
          await new Promise(r => setTimeout(r, 2000));
          router.push('/settings?broker=error');
        }
      } catch (err: any) {
        console.error('[Callback] Error:', err);
        setError(err.message || String(err));
        await new Promise(r => setTimeout(r, 2000));
        router.push('/settings?broker=error');
      } finally {
        setLoading(false);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [searchParams, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="text-center">
        {error ? (
          <>
            <div className="text-red-400 text-lg mb-4">Error: {error}</div>
            <div className="text-gray-500 text-sm">Redirecting to settings...</div>
          </>
        ) : (
          <>
            <div className="text-gray-300 text-lg mb-4">Processing broker connection...</div>
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
          </>
        )}
      </div>
    </div>
  );
}
