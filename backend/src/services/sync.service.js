// Runs a tenant's full sync in the background and records each step in sync_logs.
const { createShopifyClient } = require('./shopify/client');
const { syncCustomers, syncProducts, syncOrders } = require('./shopify/ingest');
const { forTenant } = require('./tenantDb');
const { decryptToken } = require('../utils/tokenCipher');

// Orders come last because they link to customers and products.
const FULL_SYNC_STEPS = [
  { resource: 'CUSTOMERS', run: syncCustomers },
  { resource: 'PRODUCTS', run: syncProducts },
  { resource: 'ORDERS', run: syncOrders },
];

// Tenants being synced by this server process.
const running = new Set();

const isSyncing = (tenantId) => running.has(tenantId);

const runStep = async ({ step, tenantId, db, shopify }) => {
  const log = await db.syncLog.create({
    data: { resource: step.resource, trigger: 'MANUAL' },
    select: { id: true },
  });

  try {
    const recordsSynced = await step.run({ tenantId, db, shopify });
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: 'SUCCESS', recordsSynced, finishedAt: new Date() },
      select: { id: true },
    });
  } catch (err) {
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: 'FAILED', errorMessage: err.message, finishedAt: new Date() },
      select: { id: true },
    });
    throw err;
  }
};

const runFullSync = async (tenantId) => {
  const db = forTenant(tenantId);
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { shopDomain: true, shopifyAccessToken: true },
  });
  const shopify = createShopifyClient(
    tenant.shopDomain,
    decryptToken(tenant.shopifyAccessToken, tenantId),
  );

  for (const step of FULL_SYNC_STEPS) await runStep({ step, tenantId, db, shopify });

  await db.tenant.update({
    where: { id: tenantId },
    data: { lastSyncedAt: new Date() },
    select: { id: true },
  });
};

// Doesn't wait for the sync, and a failed sync never affects the caller; failures are in
// sync_logs and shown on the status card. Returns true once a sync is running.
const triggerFullSync = (tenantId) => {
  if (running.has(tenantId)) return true;

  running.add(tenantId);
  runFullSync(tenantId)
    .catch((err) => console.error(`[sync] Full sync failed for tenant ${tenantId}: ${err.message}`))
    .finally(() => running.delete(tenantId));
  return true;
};

module.exports = { triggerFullSync, isSyncing };
