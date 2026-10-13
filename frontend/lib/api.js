// Single API client for the whole frontend.
// Every call goes to `${NEXT_PUBLIC_API_URL}/api/...` and carries the JWT if one is stored.

const API_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const TOKEN_KEY = 'xeno_token';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// localStorage only exists in the browser, so guard every access for server rendering.
export const tokenStore = {
  get() {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token) {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

async function request(path, { method = 'GET', body, headers, ...options } = {}) {
  const token = tokenStore.get();

  let res;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
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
    // Token expired or invalid: drop it so the user is asked to log in again.
    if (res.status === 401) tokenStore.clear();

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
