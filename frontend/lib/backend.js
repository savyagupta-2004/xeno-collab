// Server-side calls to the Express API. Only used by route handlers and server components;
// the browser goes through those instead (see lib/session.js).
import { NextResponse } from 'next/server';
import { API_BASE_URL, API_PREFIX } from '@/lib/constants';

// Throws only if the backend can't be reached at all.
export const backendRequest = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
    method,
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    cache: 'no-store',
  });

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
};

export const errorResponse = (status, message, code) =>
  NextResponse.json({ error: { message, code } }, { status });

export const backendUnavailable = () =>
  errorResponse(503, 'Cannot reach the server. Please try again.', 'BACKEND_UNAVAILABLE');
