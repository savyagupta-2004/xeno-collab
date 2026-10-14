import Link from 'next/link';
import { PAGE_TITLES, ROUTES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.register };

export default function RegisterPage() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold">{PAGE_TITLES.register}</h1>
      <p className="text-sm text-slate-500">Registration form coming soon.</p>
      <p className="text-sm">
        Already have an account?{' '}
        <Link href={ROUTES.login} className="font-medium text-brand-600 hover:underline">
          {PAGE_TITLES.login}
        </Link>
      </p>
    </div>
  );
}
