import Link from 'next/link';

export const metadata = { title: 'Log in · Xeno Insights' };

export default function LoginPage() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold">Log in</h1>
      <p className="text-sm text-slate-500">Login form coming soon.</p>
      <p className="text-sm">
        New here?{' '}
        <Link href="/register" className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
