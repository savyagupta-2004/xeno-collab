// Runs before every page: dashboard pages need a session, login/register don't make sense
// with one. This is a fast check of the cookie's expiry; the (dashboard) layout then confirms
// the session with the backend (/auth/me), which also catches deleted users and stores.
import { NextResponse } from 'next/server';
import {
  AUTH_ROUTES,
  DASHBOARD_ROUTES,
  ROUTES,
  SESSION_COOKIE_NAME,
  SESSION_END_REASONS,
  SESSION_QUERY_KEY,
} from '@/lib/constants';
import { clearedSessionCookie, hasUsableSession } from '@/lib/session';

const matches = (pathname, routes) =>
  routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const loggedIn = hasUsableSession(token);

  if (matches(pathname, DASHBOARD_ROUTES) && !loggedIn) {
    const url = new URL(ROUTES.login, request.url);
    // A cookie that's no longer usable means the session expired, not that they never logged in.
    if (token) url.searchParams.set(SESSION_QUERY_KEY, SESSION_END_REASONS.expired);
    const response = NextResponse.redirect(url);
    if (token) response.cookies.set(clearedSessionCookie());
    return response;
  }

  if (loggedIn && (pathname === ROUTES.home || matches(pathname, AUTH_ROUTES))) {
    return NextResponse.redirect(new URL(ROUTES.overview, request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Pages only: skip route handlers, Next.js assets and files with an extension.
  matcher: ['/((?!api|_next/static|_next/image|.*\\..*).*)'],
};
