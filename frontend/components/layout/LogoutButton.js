'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/lib/constants';
import { logout } from '@/lib/logout';

export default function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState('');

  const onLogout = async () => {
    setLoggingOut(true);
    setError('');
    await logout({
      // Stay in the "logging out" state until the login page loads.
      onLoggedOut: () => {
        router.replace(ROUTES.login);
        router.refresh();
      },
      onFailed: (message) => {
        setError(message);
        setLoggingOut(false);
      },
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
        aria-busy={loggingOut}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loggingOut ? 'Logging out…' : 'Log out'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
