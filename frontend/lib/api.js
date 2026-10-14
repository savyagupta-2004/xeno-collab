// Single API client for the whole frontend.
// Every call goes to `${API_BASE_URL}/api/...` and carries the JWT if one is stored.

import {
  API_BASE_URL,
  API_PREFIX,
  AUTH_ROUTES,
  ROUTES,
  SESSION_EXPIRED_QUERY,
  TOKEN_STORAGE_KEY,
} from '@/lib/constants';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const isBrowser = () => typeof window !== 'undefined';

// localStorage only exists in the browser, so guard every access for server rendering.
export const tokenStore = {
  get() {
    return isBrowser() ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  },
  set(token) {
    if (isBrowser()) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  },
  clear() {
    if (isBrowser()) window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  },
};

let isRedirecting = false;

// Called on any 401: drop the token and send the user back to login.
function handleUnauthorized(hadToken) {
  tokenStore.clear();

  // On login/register a 401 means wrong credentials; let the form show the error instead.
  if (!isBrowser() || isRedirecting || AUTH_ROUTES.includes(window.location.pathname)) return;

  isRedirecting = true;
  const { key, value } = SESSION_EXPIRED_QUERY;
  window.location.replace(hadToken ? `${ROUTES.login}?${key}=${value}` : ROUTES.login);
}

async function request(path, { method = 'GET', body, headers, ...options } = {}) {
  const token = tokenStore.get();

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      method,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', 0, 'NETWORK_ERROR');
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(Boolean(token));

    // Backend errors look like { error: { message, code } }
    throw new ApiError(
      data?.error?.message || `Request failed with status ${res.status}`,
      res.status,
      data?.error?.code || 'REQUEST_FAILED',
    );
  }

  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};
