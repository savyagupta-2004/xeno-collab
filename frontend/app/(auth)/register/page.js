import Link from 'next/link';

export const metadata = { title: 'Register · Xeno Insights' };

export default function RegisterPage() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <p className="text-sm text-slate-500">Registration form coming soon.</p>
      <p className="text-sm">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
