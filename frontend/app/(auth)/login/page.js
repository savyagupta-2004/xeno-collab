import Link from 'next/link';
import { PAGE_TITLES, ROUTES, SESSION_EXPIRED_QUERY } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.login };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const sessionExpired = params?.[SESSION_EXPIRED_QUERY.key] === SESSION_EXPIRED_QUERY.value;

  return (
    <div className="space-y-4 text-center">
      {sessionExpired && (
        <p
          role="alert"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          Your session has expired. Please log in again.
        </p>
      )}
      <h1 className="text-2xl font-bold">{PAGE_TITLES.login}</h1>
      <p className="text-sm text-slate-500">Login form coming soon.</p>
      <p className="text-sm">
        New here?{' '}
        <Link href={ROUTES.register} className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
