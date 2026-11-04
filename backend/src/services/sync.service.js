// Starts a tenant's full sync in the background. Each ingestion story adds its step here
// (async (tenantId) => void); until then there is nothing to run, and callers are told so
// rather than being shown a sync that didn't happen.
const fullSyncSteps = [];

const runFullSync = async (tenantId) => {
  for (const step of fullSyncSteps) await step(tenantId);
};

// Doesn't wait for the sync, and a failed sync never affects the caller.
// Returns whether a sync was started.
const triggerFullSync = (tenantId) => {
  if (fullSyncSteps.length === 0) return false;
  runFullSync(tenantId).catch((err) => {
    console.error(`[sync] Full sync failed for tenant ${tenantId}: ${err.message}`);
  });
  return true;
};

module.exports = { fullSyncSteps, triggerFullSync };
