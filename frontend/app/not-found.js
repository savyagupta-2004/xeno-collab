import Link from 'next/link';
import { APP_NAME, PAGE_TITLES, ROUTES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.notFound };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-sm font-semibold text-brand-600">{APP_NAME}</p>
        <p className="mt-4 text-5xl font-bold text-slate-900">404</p>
        <h1 className="mt-2 text-xl font-semibold">{PAGE_TITLES.notFound}</h1>
        <p className="mt-2 text-sm text-slate-500">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href={ROUTES.home}
          className="mt-6 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Go back home
        </Link>
      </div>
    </main>
  );
}
