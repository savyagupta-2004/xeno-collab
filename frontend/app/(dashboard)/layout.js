import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import { backendRequest } from '@/lib/backend';
import {
  API_ENDPOINTS,
  ROUTES,
  SESSION_COOKIE_NAME,
  SESSION_END_REASONS,
  sessionEndUrl,
} from '@/lib/constants';

// Middleware already sent visitors without a usable cookie to /login. Here the backend
// confirms the session is still valid (user and store exist, store active) before any
// dashboard page renders.
export default async function DashboardLayout({ children }) {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect(ROUTES.login);

  // A network error is thrown on purpose and shown by app/error.js: the session may be fine,
  // so the user shouldn't be logged out just because the API is briefly unreachable.
  const result = await backendRequest(API_ENDPOINTS.me, { token });

  if (result.status === 401) redirect(sessionEndUrl(SESSION_END_REASONS.expired));
  if (result.status === 403) redirect(sessionEndUrl(SESSION_END_REASONS.inactive));
  if (!result.ok) throw new Error(`Session check failed with status ${result.status}`);

  const { user, tenant } = result.data;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar user={user} tenant={tenant} />
      <main className="flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
