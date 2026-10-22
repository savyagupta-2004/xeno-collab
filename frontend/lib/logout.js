import { session } from '@/lib/api';

export const LOGOUT_FAILED_MESSAGE = 'Couldn’t log out. Check your connection and try again.';

// Only reports success once the server has actually cleared the session cookie. If the request
// fails the cookie is still valid, so the caller must not leave the dashboard as if logged out
// (the middleware would just send the user back).
export const logout = async ({ endSession = session.logout, onLoggedOut, onFailed }) => {
  try {
    await endSession();
  } catch {
    onFailed(LOGOUT_FAILED_MESSAGE);
    return false;
  }
  onLoggedOut();
  return true;
};
