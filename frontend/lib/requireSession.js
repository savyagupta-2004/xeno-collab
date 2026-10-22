// The one place dashboard pages get the logged-in user: asks the backend to verify the session
// cookie (signature, expiry, user and store still valid) on every server render.
//
// It must be called by the (dashboard) layout AND by every (dashboard) page. Next.js skips the
// shared layout when navigating between pages, so a check in the layout alone wouldn't run
// for those requests. React's cache() makes the layout and page share one /auth/me call per
// request. tests/dashboardPages.test.js fails if a page forgets to call it.
//
// middleware.js only checks the cookie's expiry (it has no JWT secret); this is the real check.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendRequest } from '@/lib/backend';
import {
  API_ENDPOINTS,
  ROUTES,
  SESSION_COOKIE_NAME,
  SESSION_END_REASONS,
  sessionEndUrl,
} from '@/lib/constants';

const requireSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) redirect(ROUTES.login);

  // A network error is thrown on purpose and shown by app/error.js: the session may be fine,
  // so the user shouldn't be logged out just because the API is briefly unreachable.
  const result = await backendRequest(API_ENDPOINTS.me, { token });

  // Forged, expired or revoked token, or the user/store was deleted: end the session.
  if (result.status === 401) redirect(sessionEndUrl(SESSION_END_REASONS.expired));
  if (result.status === 403) redirect(sessionEndUrl(SESSION_END_REASONS.inactive));
  if (!result.ok) throw new Error(`Session check failed with status ${result.status}`);

  return { user: result.data.user, tenant: result.data.tenant };
});

export default requireSession;
