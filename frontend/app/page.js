import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/constants';

// Auth guarding comes in a later story; for now the root just sends users to login.
export default function Home() {
  redirect(ROUTES.login);
}
