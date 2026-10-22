import { describe, expect, it, vi } from 'vitest';
import { LOGOUT_FAILED_MESSAGE, logout } from '@/lib/logout';

describe('logout', () => {
  it('leaves the dashboard only after the session was cleared', async () => {
    const onLoggedOut = vi.fn();
    const onFailed = vi.fn();

    const ok = await logout({ endSession: vi.fn().mockResolvedValue(null), onLoggedOut, onFailed });

    expect(ok).toBe(true);
    expect(onLoggedOut).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it('stays logged in and reports the failure when the request fails', async () => {
    const onLoggedOut = vi.fn();
    const onFailed = vi.fn();
    const networkError = Object.assign(new Error('offline'), { code: 'NETWORK_ERROR' });

    const ok = await logout({
      endSession: vi.fn().mockRejectedValue(networkError),
      onLoggedOut,
      onFailed,
    });

    expect(ok).toBe(false);
    expect(onLoggedOut).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith(LOGOUT_FAILED_MESSAGE);
  });
});
