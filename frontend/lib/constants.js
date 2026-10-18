// App-wide constants. Import from here instead of hardcoding values in components.

export const APP_NAME = 'Xeno Insights';
export const APP_DESCRIPTION = 'Multi-tenant Shopify data ingestion & insights';

// ---------- Routes ----------
export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  overview: '/overview',
  customers: '/customers',
  orders: '/orders',
  products: '/products',
  settings: '/settings',
};

export const AUTH_ROUTES = [ROUTES.login, ROUTES.register];

// ---------- Page titles ----------
export const PAGE_TITLES = {
  login: 'Log in',
  register: 'Create your account',
  overview: 'Overview',
  customers: 'Customers',
  orders: 'Orders',
  products: 'Products',
  settings: 'Settings',
  notFound: 'Page not found',
};

// ---------- Navigation ----------
export const NAV_ITEMS = [
  { href: ROUTES.overview, label: PAGE_TITLES.overview },
  { href: ROUTES.customers, label: PAGE_TITLES.customers },
  { href: ROUTES.orders, label: PAGE_TITLES.orders },
  { href: ROUTES.products, label: PAGE_TITLES.products },
  { href: ROUTES.settings, label: PAGE_TITLES.settings },
];

// Every (dashboard) page; all of them require a session.
export const DASHBOARD_ROUTES = NAV_ITEMS.map(({ href }) => href);

// ---------- API ----------
// The browser never calls the backend directly: it calls this app's own route handlers,
// which hold the session cookie and talk to the backend server-side (see lib/session.js).
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(
  /\/+$/,
  '',
);
export const API_PREFIX = '/api';
export const API_ENDPOINTS = {
  health: '/health',
  login: '/auth/login',
  register: '/auth/register',
  me: '/auth/me',
};

// Same-origin route handlers in app/api/
export const BACKEND_PROXY_PREFIX = '/api/backend';
export const SESSION_ENDPOINTS = {
  login: '/api/session/login',
  register: '/api/session/register',
  logout: '/api/session',
  end: '/api/session/end',
};

// ---------- Session ----------
export const SESSION_COOKIE_NAME = 'xeno_session';

// Why the user was sent back to login: /login?session=expired | /login?session=inactive
export const SESSION_QUERY_KEY = 'session';
export const SESSION_END_REASONS = {
  expired: 'expired',
  inactive: 'inactive',
};

// /api/session/end?reason=expired: clears the cookie, then redirects to login with the reason
export const SESSION_END_REASON_PARAM = 'reason';
export const sessionEndUrl = (reason) =>
  `${SESSION_ENDPOINTS.end}?${SESSION_END_REASON_PARAM}=${reason}`;

export const SESSION_END_MESSAGES = {
  [SESSION_END_REASONS.expired]: 'Your session has expired. Please log in again.',
  [SESSION_END_REASONS.inactive]: 'This store has been deactivated.',
};

// ---------- Validation (mirrors the backend rules) ----------
export const VALIDATION = {
  passwordMinLength: 8,
  passwordMaxBytes: 72,
  textMaxLength: 100,
};
