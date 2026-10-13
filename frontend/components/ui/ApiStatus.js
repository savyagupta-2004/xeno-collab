'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Small indicator that the frontend can reach the backend via the shared API client.
export default function ApiStatus() {
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    api
      .get('/health')
      .then(() => !cancelled && setStatus('online'))
      .catch(() => !cancelled && setStatus('offline'));
    return () => {
      cancelled = true;
    };
  }, []);

  const styles = {
    checking: 'bg-slate-300',
    online: 'bg-emerald-500',
    offline: 'bg-rose-500',
  };

  return (
    <p className="flex items-center gap-2 text-xs text-slate-500">
      <span className={`h-2 w-2 rounded-full ${styles[status]}`} />
      API {status}
    </p>
  );
}
