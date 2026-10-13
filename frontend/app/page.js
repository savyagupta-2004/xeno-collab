import { redirect } from 'next/navigation';

// Auth guarding comes in a later story; for now the root just sends users to login.
export default function Home() {
  redirect('/login');
}
