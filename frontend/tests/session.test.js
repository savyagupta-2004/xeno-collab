import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '@/lib/constants';
import {
  clearedSessionCookie,
  getTokenExpiry,
  hasUsableSession,
  sessionCookie,
} from '@/lib/session';
import { fakeJwt, inSeconds } from './helpers';

describe('session token helpers', () => {
  it('reads exp from the token', () => {
    const exp = inSeconds(3600);
    expect(getTokenExpiry(fakeJwt({ exp }))).toBe(exp * 1000);
  });

  it.each([
    ['missing', undefined],
    ['not a JWT', 'garbage'],
    ['without exp', fakeJwt({ userId: 'u' })],
    ['expired', fakeJwt({ exp: inSeconds(-10) })],
  ])('treats a %s token as no session', (_label, token) => {
    expect(hasUsableSession(token)).toBe(false);
  });

  it('accepts a token that has not expired yet', () => {
    expect(hasUsableSession(fakeJwt({ exp: inSeconds(60) }))).toBe(true);
  });
});

describe('session cookie', () => {
  it('is httpOnly, SameSite=Lax, site-wide and expires with the JWT', () => {
    const exp = inSeconds(24 * 3600);
    const cookie = sessionCookie(fakeJwt({ exp }));

    expect(cookie).toMatchObject({
      name: SESSION_COOKIE_NAME,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(cookie.expires.getTime()).toBe(exp * 1000);
  });

  it('is cleared with an empty value and maxAge 0', () => {
    expect(clearedSessionCookie()).toMatchObject({
      name: SESSION_COOKIE_NAME,
      value: '',
      maxAge: 0,
      httpOnly: true,
    });
  });
});
