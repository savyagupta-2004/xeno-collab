import { NextResponse } from 'next/server';
import {
  ROUTES,
  SESSION_END_REASON_PARAM,
  SESSION_END_REASONS,
  SESSION_QUERY_KEY,
} from '@/lib/constants';
import { clearedSessionCookie } from '@/lib/session';

// Server components can't delete cookies, so when the dashboard finds the session is no longer
// valid it redirects here: the cookie is deleted and the user lands on /login with the reason.
export const GET = (request) => {
  const requested = request.nextUrl.searchParams.get(SESSION_END_REASON_PARAM);
  const reason = Object.values(SESSION_END_REASONS).includes(requested)
    ? requested
    : SESSION_END_REASONS.expired;

  const url = new URL(ROUTES.login, request.url);
  url.searchParams.set(SESSION_QUERY_KEY, reason);

  const response = NextResponse.redirect(url);
  response.cookies.set(clearedSessionCookie());
  return response;
};
