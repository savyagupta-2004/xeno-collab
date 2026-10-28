// Minimal Shopify Admin GraphQL client for the dev-store scripts (no SDK needed).
//
// Credentials, from backend/.env (never committed):
// - SHOPIFY_STORE_DOMAIN      e.g. xeno-demo-main.myshopify.com
// - SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET   app created in the Shopify Dev Dashboard;
//   a 24h token is requested with the client credentials grant
// - or SHOPIFY_ADMIN_TOKEN    a token you already have (legacy custom app "shpat_..." token)

const DEFAULT_API_VERSION = '2026-10';
const MAX_ATTEMPTS = 5;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ShopifyError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ShopifyError';
    this.details = details;
  }
}

// Accepts "my-store", "my-store.myshopify.com" or "https://my-store.myshopify.com/".
const normalizeStoreDomain = (value) => {
  const host = String(value || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
  if (!host) throw new ShopifyError('SHOPIFY_STORE_DOMAIN is not set');
  const domain = host.endsWith('.myshopify.com') ? host : `${host}.myshopify.com`;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new ShopifyError(`"${value}" is not a valid myshopify.com domain`);
  }
  return domain;
};

const readJson = async (res) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
};

// Client credentials grant (Dev Dashboard apps): exchanges the app's Client ID and secret for an
// Admin API token valid for 24 hours. Only works for stores in the app's own organization.
const requestAccessToken = async ({ domain, clientId, clientSecret, fetchImpl = fetch }) => {
  const res = await fetchImpl(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const body = await readJson(res);

  if (!res.ok || !body.access_token) {
    const reason = body.error || body.errors || body.raw || `HTTP ${res.status}`;
    const hint = String(reason).includes('shop_not_permitted')
      ? ' The store must be created from the Dev Dashboard in the same organization as the app.'
      : ' Check the Client ID/secret and that the app is installed on this store.';
    throw new ShopifyError(`Could not get an access token for ${domain}: ${reason}.${hint}`, body);
  }

  return { accessToken: body.access_token, scope: body.scope, expiresIn: body.expires_in };
};

// Resolves the token from env: an explicit token wins, otherwise the client credentials grant.
const getAccessToken = async (env = process.env, { fetchImpl = fetch } = {}) => {
  const domain = normalizeStoreDomain(env.SHOPIFY_STORE_DOMAIN);

  if (env.SHOPIFY_ADMIN_TOKEN) {
    return { domain, accessToken: env.SHOPIFY_ADMIN_TOKEN, source: 'SHOPIFY_ADMIN_TOKEN' };
  }
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
    const token = await requestAccessToken({
      domain,
      clientId: env.SHOPIFY_CLIENT_ID,
      clientSecret: env.SHOPIFY_CLIENT_SECRET,
      fetchImpl,
    });
    return { domain, ...token, source: 'client credentials grant' };
  }
  throw new ShopifyError(
    'Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard app), or SHOPIFY_ADMIN_TOKEN, in backend/.env',
  );
};

const isThrottled = (body) =>
  Array.isArray(body?.errors) && body.errors.some((e) => e.extensions?.code === 'THROTTLED');

// How long until enough query cost has been restored (Shopify's leaky bucket), in ms.
const throttleWaitMs = (body) => {
  const cost = body?.extensions?.cost;
  const status = cost?.throttleStatus;
  if (!status) return 2000;
  const missing = Math.max(cost.requestedQueryCost - status.currentlyAvailable, 0);
  return Math.ceil((missing / Math.max(status.restoreRate, 1)) * 1000) + 500;
};

const createShopifyClient = ({
  domain,
  accessToken,
  apiVersion = DEFAULT_API_VERSION,
  fetchImpl = fetch,
  sleep = realSleep,
}) => {
  const url = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

  // Runs a query/mutation and returns `data`. Rate limits are always retried: Shopify rejects
  // throttled requests before running them. Network errors and 5xx are only retried when
  // `idempotent` (queries, and mutations Shopify can deduplicate): otherwise the request may
  // already have been applied, so the error is thrown with `outcomeUnknown` and the caller must
  // check before trying again (a blind retry could create a duplicate order).
  const graphql = async (query, variables = {}, { idempotent = true } = {}) => {
    const unknownOutcome = (message, details) =>
      Object.assign(new ShopifyError(message, details), { outcomeUnknown: true });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          body: JSON.stringify({ query, variables }),
        });
      } catch (err) {
        if (!idempotent) throw unknownOutcome(`Network error: ${err.message}`);
        if (attempt === MAX_ATTEMPTS) throw new ShopifyError(`Network error: ${err.message}`);
        await sleep(1000 * attempt);
        continue;
      }

      const body = await readJson(res);

      if (res.status === 429 || isThrottled(body)) {
        if (attempt === MAX_ATTEMPTS)
          throw new ShopifyError('Still rate limited after retries', body);
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : throttleWaitMs(body));
        continue;
      }
      if (res.status >= 500) {
        if (!idempotent) throw unknownOutcome(`Shopify error HTTP ${res.status}`, body);
        if (attempt === MAX_ATTEMPTS)
          throw new ShopifyError(`Shopify error HTTP ${res.status}`, body);
        await sleep(1000 * attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new ShopifyError(
          `Shopify rejected the token (HTTP ${res.status}). Check the app's scopes and that it is installed.`,
          body,
        );
      }
      if (!res.ok || body.errors) {
        const messages = Array.isArray(body.errors)
          ? body.errors.map((e) => e.message).join('; ')
          : JSON.stringify(body.errors || body.raw);
        throw new ShopifyError(`GraphQL error: ${messages}`, body);
      }
      return body.data;
    }
    throw new ShopifyError('Unreachable');
  };

  return { domain, apiVersion, graphql };
};

// Throws if a mutation returned userErrors (Shopify reports validation problems this way).
const assertNoUserErrors = (payload, label) => {
  const errors = payload?.userErrors || payload?.orderCancelUserErrors || [];
  if (errors.length > 0) {
    const text = errors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; ');
    throw new ShopifyError(`${label} failed: ${text}`, errors);
  }
  return payload;
};

module.exports = {
  DEFAULT_API_VERSION,
  ShopifyError,
  normalizeStoreDomain,
  requestAccessToken,
  getAccessToken,
  createShopifyClient,
  assertNoUserErrors,
};
