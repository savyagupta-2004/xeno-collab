import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from '@/middleware';
import { DASHBOARD_ROUTES, SESSION_COOKIE_NAME } from '@/lib/constants';
import { fakeJwt, inSeconds } from './helpers';

const visit = (path, token) => {
  const request = new NextRequest(`http://localhost:3000${path}`);
  if (token) request.cookies.set(SESSION_COOKIE_NAME, token);
  return middleware(request);
};

const validToken = () => fakeJwt({ exp: inSeconds(3600) });
const expiredToken = () => fakeJwt({ exp: inSeconds(-10) });
const location = (response) => response.headers.get('location');

describe('dashboard routes', () => {
  it.each(DASHBOARD_ROUTES)('%s redirects to /login without a session', (route) => {
    const response = visit(route);

    expect(response.status).toBe(307);
    expect(location(response)).toBe('http://localhost:3000/login');
  });

  it('protects nested dashboard paths too', () => {
    expect(location(visit('/orders/42'))).toBe('http://localhost:3000/login');
  });

  it('redirects an expired session to /login?session=expired and deletes the cookie', () => {
    const response = visit('/overview', expiredToken());

    expect(location(response)).toBe('http://localhost:3000/login?session=expired');
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({ value: '', maxAge: 0 });
  });

  it.each(DASHBOARD_ROUTES)('%s is allowed with a usable session', (route) => {
    const response = visit(route, validToken());

    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});

describe('login and register', () => {
  it.each(['/login', '/register', '/'])('%s sends a logged-in user to /overview', (route) => {
    expect(location(visit(route, validToken()))).toBe('http://localhost:3000/overview');
  });

  it.each(['/login', '/register'])('%s is shown without a session', (route) => {
    expect(visit(route).headers.get('x-middleware-next')).toBe('1');
  });
});
