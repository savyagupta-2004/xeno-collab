import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as login } from '@/app/api/session/login/route';
import { DELETE as logout } from '@/app/api/session/route';
import { GET as endSession } from '@/app/api/session/end/route';
import { GET as proxyGet, POST as proxyPost } from '@/app/api/backend/[...path]/route';
import { SESSION_COOKIE_NAME } from '@/lib/constants';
import { fakeJwt, inSeconds, stubBackend } from './helpers';

const json = (path, body, init = {}) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  });

const withSession = (request, token) => {
  request.cookies.set(SESSION_COOKIE_NAME, token);
  return request;
};

const params = (...path) => ({ params: Promise.resolve({ path }) });

afterEach(() => vi.unstubAllGlobals());

describe('POST /api/session/login', () => {
  it('stores the JWT in an httpOnly cookie and never returns it to the browser', async () => {
    const token = fakeJwt({ exp: inSeconds(3600) });
    stubBackend(vi, { body: { token, user: { id: 'u' }, tenant: { id: 't' } } });

    const response = await login(json('/api/session/login', { email: 'a@b.co', password: 'x' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: 'u' }, tenant: { id: 't' } });
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({
      value: token,
      httpOnly: true,
      sameSite: 'lax',
    });
  });

  it('passes backend errors through without setting a cookie', async () => {
    const error = { error: { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' } };
    stubBackend(vi, { status: 401, body: error });

    const response = await login(json('/api/session/login', { email: 'a@b.co', password: 'x' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(error);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('returns 503 when the backend is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const response = await login(json('/api/session/login', {}));

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe('BACKEND_UNAVAILABLE');
  });
});

describe('session end', () => {
  it('logout deletes the cookie', async () => {
    const response = await logout();

    expect(response.status).toBe(204);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('/api/session/end deletes the cookie and redirects to login with the reason', async () => {
    const response = await endSession(
      new NextRequest('http://localhost:3000/api/session/end?reason=inactive'),
    );

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?session=inactive');
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({ value: '', maxAge: 0 });
  });

  it('/api/session/end ignores unknown reasons', async () => {
    const response = await endSession(
      new NextRequest('http://localhost:3000/api/session/end?reason=<script>'),
    );

    expect(response.headers.get('location')).toBe('http://localhost:3000/login?session=expired');
  });
});

describe('/api/backend/* proxy', () => {
  it('forwards to the API with the token from the cookie as a Bearer header', async () => {
    const fetchMock = stubBackend(vi, { body: { customer: { id: 1 } } });
    const token = fakeJwt({ exp: inSeconds(3600) });

    const response = await proxyGet(
      withSession(new NextRequest('http://localhost:3000/api/backend/customers/1?x=1'), token),
      params('customers', '1'),
    );

    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:5000/api/customers/1?x=1');
    expect(init.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('deletes the cookie when the API rejects the session', async () => {
    stubBackend(vi, { status: 401, body: { error: { code: 'TOKEN_EXPIRED' } } });

    const response = await proxyGet(
      withSession(new NextRequest('http://localhost:3000/api/backend/auth/me'), 'old-token'),
      params('auth', 'me'),
    );

    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toMatchObject({ value: '', maxAge: 0 });
  });

  it.each([
    ['login', ['auth', 'login']],
    ['register', ['auth', 'register']],
  ])('refuses %s, so a token can never reach the browser', async (_label, path) => {
    const fetchMock = stubBackend(vi);

    const response = await proxyPost(json(`/api/backend/${path.join('/')}`, {}), params(...path));

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects path traversal', async () => {
    const fetchMock = stubBackend(vi);

    const response = await proxyGet(
      new NextRequest('http://localhost:3000/api/backend/x'),
      params('..', 'admin'),
    );

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
