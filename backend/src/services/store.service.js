const AppError = require('../utils/AppError');
const { encryptToken } = require('../utils/tokenCipher');
const { getTokenEncryptionKey } = require('../config/shopify');
const { createShopifyClient, ERROR_CODES } = require('./shopify/client');
const { triggerFullSync } = require('./sync.service');
const { forTenant } = require('./tenantDb');

const VALIDATE_STORE_QUERY = `query ValidateStore {
  shop { name myshopifyDomain }
  currentAppInstallation { accessScopes { handle } }
}`;

// What ingestion needs. write_x also grants read_x.
const REQUIRED_SCOPES = ['read_customers', 'read_products', 'read_orders'];

const SHOPIFY_DOWN_CODES = new Set([
  ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.SERVER_ERROR,
  ERROR_CODES.NETWORK_ERROR,
  ERROR_CODES.TIMEOUT,
]);

const storeError = (field, message) =>
  new AppError(message, 422, 'SHOPIFY_AUTH_FAILED', { [field]: message });

// Bad Shopify credentials are 422, never 401: a 401 here would mean the user's own session
// has ended and would log them out.
const toStoreError = (err) => {
  if (err.code === ERROR_CODES.NOT_FOUND) {
    return storeError('shopDomain', 'No Shopify store found at this domain');
  }
  if (err.code === ERROR_CODES.UNAUTHORIZED || err.code === ERROR_CODES.FORBIDDEN) {
    return storeError('accessToken', 'Shopify rejected this access token');
  }
  if (SHOPIFY_DOWN_CODES.has(err.code)) {
    return new AppError('Could not reach Shopify. Please try again.', 424, 'SHOPIFY_UNAVAILABLE');
  }
  return err;
};

const missingScopes = (grantedHandles) => {
  const granted = new Set(grantedHandles);
  return REQUIRED_SCOPES.filter(
    (scope) => !granted.has(scope) && !granted.has(scope.replace('read_', 'write_')),
  );
};

const validateCredentials = async (shopDomain, accessToken) => {
  let data;
  try {
    data = await createShopifyClient(shopDomain, accessToken).request(VALIDATE_STORE_QUERY);
  } catch (err) {
    throw toStoreError(err);
  }

  const handles = data.currentAppInstallation.accessScopes.map((scope) => scope.handle);
  const missing = missingScopes(handles);
  if (missing.length > 0) {
    throw new AppError(
      `This access token is missing the scopes: ${missing.join(', ')}`,
      422,
      'MISSING_SCOPES',
    );
  }
};

const isShopDomainConflict = (err) =>
  err?.code === 'P2002' &&
  [].concat(err.meta?.target ?? []).some((target) => String(target).includes('shop_domain'));

const getStoreStatus = async (tenantId) => {
  const db = forTenant(tenantId);
  const [tenant, customers, products, orders] = await Promise.all([
    db.tenant.findUnique({
      where: { id: tenantId },
      select: { shopDomain: true, shopifyAccessToken: true, lastSyncedAt: true },
    }),
    db.customer.count(),
    db.product.count(),
    db.order.count(),
  ]);

  return {
    shopDomain: tenant.shopDomain,
    connected: Boolean(tenant.shopDomain && tenant.shopifyAccessToken),
    lastSyncedAt: tenant.lastSyncedAt,
    counts: { customers, products, orders },
  };
};

const connectStore = async (tenantId, { shopDomain, accessToken }) => {
  getTokenEncryptionKey(); // fail before calling Shopify if the server isn't configured

  const db = forTenant(tenantId);
  const current = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { shopDomain: true },
  });

  // One tenant is one store: its synced data must never mix with another store's.
  if (current.shopDomain && current.shopDomain !== shopDomain) {
    throw new AppError(
      `This account is already connected to ${current.shopDomain}`,
      409,
      'STORE_CONNECTED',
    );
  }

  // Credentials are checked first, so only someone holding a valid token for a store can
  // learn that it's connected to another account.
  await validateCredentials(shopDomain, accessToken);

  try {
    await db.tenant.update({
      where: { id: tenantId },
      data: { shopDomain, shopifyAccessToken: encryptToken(accessToken, tenantId) },
      select: { id: true },
    });
  } catch (err) {
    if (isShopDomainConflict(err)) {
      throw new AppError('This store is connected to another account', 409, 'STORE_TAKEN');
    }
    throw err;
  }

  const firstSyncStarted = triggerFullSync(tenantId);
  return { store: await getStoreStatus(tenantId), firstSyncStarted };
};

module.exports = { connectStore, getStoreStatus, REQUIRED_SCOPES };
