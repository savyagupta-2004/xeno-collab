// Same-origin pass-through to the Express API: attaches the JWT from the httpOnly session
// cookie, so client components can call the API without ever seeing the token.
import { NextResponse } from 'next/server';
import { API_ENDPOINTS, SESSION_COOKIE_NAME } from '@/lib/constants';
import { backendRequest, backendUnavailable, errorResponse } from '@/lib/backend';
import { clearedSessionCookie } from '@/lib/session';

// Login/register return a token, so they must go through /api/session/* (which keeps the
// token in the cookie) and never through here (which would hand it to the browser).
const BLOCKED_PATHS = new Set([API_ENDPOINTS.login, API_ENDPOINTS.register]);

const notFound = () => errorResponse(404, 'Not found', 'NOT_FOUND');

const proxy = async (request, { params }) => {
  const { path = [] } = await params;
  if (path.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return notFound();
  }

  const target = `/${path.map(encodeURIComponent).join('/')}`;
  if (BLOCKED_PATHS.has(target)) return notFound();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = hasBody ? (await request.text()) || undefined : undefined;

  let result;
  try {
    result = await backendRequest(`${target}${request.nextUrl.search}`, {
      method: request.method,
      token,
      body,
    });
  } catch {
    return backendUnavailable();
  }

  const response =
    result.status === 204
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json(result.data, { status: result.status });

  // The backend rejected the session (expired, user deleted...): drop the dead cookie.
  if (result.status === 401 && token) response.cookies.set(clearedSessionCookie());
  return response;
};

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
