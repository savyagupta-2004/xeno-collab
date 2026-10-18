'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LogoutButton from '@/components/layout/LogoutButton';
import ApiStatus from '@/components/ui/ApiStatus';
import { APP_NAME, NAV_ITEMS } from '@/lib/constants';

export default function Sidebar({ user, tenant }) {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col border-b border-slate-200 bg-white md:w-60 md:border-b-0 md:border-r">
      <div className="px-6 py-5">
        <p className="text-lg font-semibold text-brand-600">{APP_NAME}</p>
        <p className="truncate text-sm text-slate-500">{tenant.name}</p>
      </div>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
        {NAV_ITEMS.map(({ href, label }) => {
          const isActive = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-slate-200 px-6 py-4">
        <p className="truncate text-xs text-slate-500" title={user.email}>
          {user.email}
        </p>
        <LogoutButton />
        <div className="hidden md:block">
          <ApiStatus />
        </div>
      </div>
    </aside>
  );
}
