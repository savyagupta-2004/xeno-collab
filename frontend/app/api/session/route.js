import { NextResponse } from 'next/server';
import { clearedSessionCookie } from '@/lib/session';

// Logout: deletes the session cookie.
export const DELETE = () => {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(clearedSessionCookie());
  return response;
};
