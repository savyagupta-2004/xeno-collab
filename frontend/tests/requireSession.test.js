import { beforeEach, describe, expect, it, vi } from 'vitest';

const cookieStore = { get: vi.fn() };
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
// redirect() never returns in Next.js; it throws to stop rendering.
vi.mock('next/navigation', () => ({
  redirect: (url) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock('@/lib/backend', () => ({ backendRequest: vi.fn() }));

const { backendRequest } = await import('@/lib/backend');
const { default: requireSession } = await import('@/lib/requireSession');

const withCookie = (value) => cookieStore.get.mockReturnValue(value ? { value } : undefined);

beforeEach(() => vi.clearAllMocks());

describe('requireSession', () => {
  it('sends visitors without a session cookie to /login', async () => {
    withCookie(undefined);

    await expect(requireSession()).rejects.toThrow('REDIRECT /login');
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('asks the backend to verify the token on every call', async () => {
    withCookie('some.jwt.token');
    backendRequest.mockResolvedValue({
      ok: true,
      status: 200,
      data: { user: { id: 'u' }, tenant: { id: 't' } },
    });

    await expect(requireSession()).resolves.toEqual({ user: { id: 'u' }, tenant: { id: 't' } });
    expect(backendRequest).toHaveBeenCalledWith('/auth/me', { token: 'some.jwt.token' });
  });

  it('ends the session when the backend rejects the token (forged, expired, revoked)', async () => {
    withCookie('forged.jwt.token');
    backendRequest.mockResolvedValue({ ok: false, status: 401, data: null });

    await expect(requireSession()).rejects.toThrow('REDIRECT /api/session/end?reason=expired');
  });

  it('ends the session as "inactive" when the store is deactivated', async () => {
    withCookie('some.jwt.token');
    backendRequest.mockResolvedValue({ ok: false, status: 403, data: null });

    await expect(requireSession()).rejects.toThrow('REDIRECT /api/session/end?reason=inactive');
  });

  it("doesn't log the user out when the backend has an unexpected error", async () => {
    withCookie('some.jwt.token');
    backendRequest.mockResolvedValue({ ok: false, status: 500, data: null });

    await expect(requireSession()).rejects.toThrow('Session check failed with status 500');
  });
});
