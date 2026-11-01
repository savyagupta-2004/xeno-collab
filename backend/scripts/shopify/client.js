// Token helpers for the dev-store scripts. API calls go through the app's shared Shopify client
// (src/services/shopify/client.js), so retries, rate limits and errors behave the same everywhere.
//
// Credentials, from backend/.env (never committed):
// - SHOPIFY_STORE_DOMAIN      e.g. xeno-demo-main.myshopify.com
// - SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET   app created in the Shopify Dev Dashboard;
//   a 24h token is requested with the client credentials grant
// - or SHOPIFY_ADMIN_TOKEN    a token you already have (legacy custom app "shpat_..." token)
const { normalizeShopDomain } = require('../../src/services/shopify/client');

class ShopifyError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ShopifyError';
    this.details = details;
  }
}

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
  if (!env.SHOPIFY_STORE_DOMAIN) throw new ShopifyError('SHOPIFY_STORE_DOMAIN is not set');
  const domain = normalizeShopDomain(env.SHOPIFY_STORE_DOMAIN);

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

// Throws if a mutation returned userErrors (Shopify reports validation problems this way).
const assertNoUserErrors = (payload, label) => {
  const errors = payload?.userErrors || payload?.orderCancelUserErrors || [];
  if (errors.length > 0) {
    const text = errors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; ');
    throw new ShopifyError(`${label} failed: ${text}`, errors);
  }
  return payload;
};

module.exports = { ShopifyError, requestAccessToken, getAccessToken, assertNoUserErrors };
