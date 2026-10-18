'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { session } from '@/lib/api';
import { ROUTES } from '@/lib/constants';

export default function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await session.logout();
    } finally {
      // Leave the dashboard even if the request failed; the middleware re-checks the cookie.
      router.replace(ROUTES.login);
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={loggingOut}
      aria-busy={loggingOut}
      className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
    >
      {loggingOut ? 'Logging out…' : 'Log out'}
    </button>
  );
}
