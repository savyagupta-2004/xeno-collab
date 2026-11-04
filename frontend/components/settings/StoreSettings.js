'use client';

import { useEffect, useState } from 'react';
import ConnectStoreForm from '@/components/settings/ConnectStoreForm';
import StoreStatusCard from '@/components/settings/StoreStatusCard';
import FormAlert from '@/components/ui/FormAlert';
import { api } from '@/lib/api';
import { API_ENDPOINTS, SYNC_REFRESH_MS } from '@/lib/constants';

export default function StoreSettings() {
  const [store, setStore] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get(API_ENDPOINTS.storeStatus)
      .then((data) => !cancelled && setStore(data.store))
      .catch((error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the card while a sync runs, so the counts climb and the result appears by itself.
  const syncing = Boolean(store?.sync.running);
  useEffect(() => {
    if (!syncing) return undefined;
    const timer = setInterval(() => {
      api
        .get(API_ENDPOINTS.storeStatus)
        .then((data) => setStore(data.store))
        .catch(() => {}); // a missed refresh is fine, the next one tries again
    }, SYNC_REFRESH_MS);
    return () => clearInterval(timer);
  }, [syncing]);

  const onConnected = ({ store: connected, firstSyncStarted }) => {
    setStore(connected);
    setNotice(
      firstSyncStarted ? 'Store connected. The first sync has started.' : 'Store connected.',
    );
    setFormKey((key) => key + 1); // new form instance: the token doesn't stay on screen
  };

  if (loadError) return <FormAlert>{loadError}</FormAlert>;
  if (!store) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="grid max-w-4xl gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <FormAlert tone="success">{notice}</FormAlert>
        <StoreStatusCard store={store} />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <ConnectStoreForm
          key={formKey}
          connectedDomain={store.shopDomain}
          onConnected={onConnected}
        />
      </div>
    </div>
  );
}
