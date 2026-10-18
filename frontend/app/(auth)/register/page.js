import Link from 'next/link';
import RegisterForm from '@/components/auth/RegisterForm';
import { PAGE_TITLES, ROUTES } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.register };

export default function RegisterPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-center text-2xl font-bold">{PAGE_TITLES.register}</h1>
      <RegisterForm />
      <p className="text-center text-sm">
        Already have an account?{' '}
        <Link href={ROUTES.login} className="font-medium text-brand-600 hover:underline">
          {PAGE_TITLES.login}
        </Link>
      </p>
    </div>
  );
}
