// Single API client for the browser.
// It only calls this app's own route handlers: the session lives in an httpOnly cookie that
// those handlers turn into `Authorization: Bearer <jwt>` for the backend (see lib/session.js).
import {
  AUTH_ROUTES,
  BACKEND_PROXY_PREFIX,
  ROUTES,
  SESSION_END_REASONS,
  SESSION_ENDPOINTS,
  SESSION_QUERY_KEY,
} from '@/lib/constants';

export class ApiError extends Error {
  constructor(message, status, code, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const isBrowser = () => typeof window !== 'undefined';

let isRedirecting = false;

// The session is gone (expired, user or store removed): back to login.
const handleUnauthorized = () => {
  if (!isBrowser() || isRedirecting || AUTH_ROUTES.includes(window.location.pathname)) return;
  isRedirecting = true;
  window.location.replace(`${ROUTES.login}?${SESSION_QUERY_KEY}=${SESSION_END_REASONS.expired}`);
};

async function request(url, { method = 'GET', body, redirectOnUnauthorized = true } = {}) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Cannot reach the server. Please try again.', 0, 'NETWORK_ERROR');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && redirectOnUnauthorized) handleUnauthorized();

    // Backend errors look like { error: { message, code, fields? } }
    throw new ApiError(
      data?.error?.message || `Request failed with status ${res.status}`,
      res.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.fields,
    );
  }

  return data;
}

const backend = (path) => `${BACKEND_PROXY_PREFIX}${path}`;

export const api = {
  get: (path) => request(backend(path)),
  post: (path, body) => request(backend(path), { method: 'POST', body }),
  put: (path, body) => request(backend(path), { method: 'PUT', body }),
  patch: (path, body) => request(backend(path), { method: 'PATCH', body }),
  delete: (path) => request(backend(path), { method: 'DELETE' }),
};

// Login/register/logout. A 401 here means wrong credentials, so the form shows it instead
// of redirecting.
export const session = {
  login: (credentials) =>
    request(SESSION_ENDPOINTS.login, {
      method: 'POST',
      body: credentials,
      redirectOnUnauthorized: false,
    }),
  register: (details) =>
    request(SESSION_ENDPOINTS.register, {
      method: 'POST',
      body: details,
      redirectOnUnauthorized: false,
    }),
  logout: () =>
    request(SESSION_ENDPOINTS.logout, { method: 'DELETE', redirectOnUnauthorized: false }),
};
