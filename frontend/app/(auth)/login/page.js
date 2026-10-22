import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';
import FormAlert from '@/components/ui/FormAlert';
import { PAGE_TITLES, ROUTES, SESSION_END_MESSAGES, SESSION_QUERY_KEY } from '@/lib/constants';

export const metadata = { title: PAGE_TITLES.login };

export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const sessionEndMessage = SESSION_END_MESSAGES[params?.[SESSION_QUERY_KEY]];

  return (
    <div className="space-y-6">
      <h1 className="text-center text-2xl font-bold">{PAGE_TITLES.login}</h1>
      <FormAlert tone="warning">{sessionEndMessage}</FormAlert>
      <LoginForm />
      <p className="text-center text-sm">
        New here?{' '}
        <Link href={ROUTES.register} className="font-medium text-brand-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
