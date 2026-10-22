// Shared by the login and register route handlers: forwards the form to the backend and,
// on success, keeps the JWT in the httpOnly cookie and returns only the profile.
import { NextResponse } from 'next/server';
import { backendRequest, backendUnavailable } from '@/lib/backend';
import { sessionCookie } from '@/lib/session';

export const startSession = async (request, endpoint) => {
  const body = await request.json().catch(() => ({}));

  let result;
  try {
    result = await backendRequest(endpoint, { method: 'POST', body });
  } catch {
    return backendUnavailable();
  }

  if (!result.ok || !result.data?.token) {
    return NextResponse.json(result.data, { status: result.ok ? 502 : result.status });
  }

  const { token, ...profile } = result.data;
  const response = NextResponse.json(profile, { status: result.status });
  response.cookies.set(sessionCookie(token));
  return response;
};
