// How the login session is stored (XENO-7)
// ----------------------------------------
// Choice: the backend's JWT is kept in an httpOnly cookie on THIS app's own domain, and the
// browser never sees the token.
//
//   browser ──(cookie)──> Next.js route handlers (app/api/session/*, app/api/backend/*)
//                               └──(Authorization: Bearer <jwt>)──> Express API
//
// Why:
// - httpOnly: page JavaScript can't read the cookie, so an XSS bug can't steal the session
//   (unlike localStorage, which XENO-3 used before).
// - First-party: the frontend (Vercel) and API (Render) are on different domains. A cookie set
//   by the API would be a third-party cookie, which Safari blocks and Chrome restricts. Setting
//   it from the Next.js server keeps it first-party, and the browser needs no CORS.
// - SameSite=Lax: the cookie isn't sent on cross-site POSTs, which blocks CSRF on the
//   same-origin route handlers. Secure in production, so it only travels over HTTPS.
// - The cookie expires when the JWT does (24h).
//
// Trade-offs:
// - Every API call goes through the Next.js server (one extra hop).
// - Logout deletes the cookie; the JWT itself stays valid until it expires (stateless). The
//   backend still rejects it immediately if the user or store is deleted or deactivated.
//
// This file is used by middleware (edge runtime) and route handlers, so it only uses
// web-standard APIs.
import { SESSION_COOKIE_NAME } from '@/lib/constants';

// Reads `exp` from a JWT without verifying it. Middleware uses this as a fast pre-check;
// the backend verifies the signature on every real request.
export const getTokenExpiry = (token) => {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload));
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
};

export const hasUsableSession = (token, now = Date.now()) => {
  const expiresAt = token ? getTokenExpiry(token) : null;
  return expiresAt !== null && expiresAt > now;
};

const baseCookie = () => ({
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
});

export const sessionCookie = (token) => ({
  ...baseCookie(),
  value: token,
  expires: new Date(getTokenExpiry(token) ?? Date.now()),
});

export const clearedSessionCookie = () => ({ ...baseCookie(), value: '', maxAge: 0 });
