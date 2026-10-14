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

// ---------- API ----------
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(
  /\/+$/,
  '',
);
export const API_PREFIX = '/api';
export const API_ENDPOINTS = {
  health: '/health',
};

// ---------- Auth ----------
export const TOKEN_STORAGE_KEY = 'xeno_token';

// Added to the login URL when a session expires: /login?session=expired
export const SESSION_EXPIRED_QUERY = { key: 'session', value: 'expired' };
