// Tenant-scoped database access.
//
// forTenant(tenantId) returns a Prisma client where every query is automatically limited to
// one tenant: reads/updates/deletes get `AND tenant_id = <tenantId>`, creates get tenantId set,
// and writing into another tenant throws. Services must use this instead of the base client
// (enforced by ESLint, see eslint.config.js). Exceptions that need the base client on purpose
// (registering a tenant, logging in by email) live in auth.service.js.
//
// Not covered by the extension, so handle them explicitly if you ever need them:
// - nested writes (e.g. order.create with lineItems: { create: [...] }) must set tenantId on children
// - raw SQL is blocked on the scoped client; use the base client and filter tenant_id yourself
const { prisma } = require('../config/prisma');

// Every model must be listed here, so a new model can't be left unscoped by accident.
const TENANT_SCOPED_MODELS = new Set([
  'User',
  'Customer',
  'Product',
  'Order',
  'OrderLineItem',
  'Event',
  'SyncLog',
]);

// Operations whose `where` must be limited to the tenant.
const FILTERED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

// A tenant-scoped client may read and update its own Tenant row, but never create or delete tenants.
const TENANT_OPERATIONS_BLOCKED = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

const toArray = (value) => (value === undefined ? [] : [].concat(value));

// Keeps the caller's filter and adds the tenant condition with AND, so a caller can narrow the
// result but never widen it (e.g. asking for another tenant's id simply matches nothing).
const withTenantFilter = (where = {}, condition) => ({
  ...where,
  AND: [...toArray(where.AND), condition],
});

const assertSameTenant = (data, tenantId, model) => {
  if (data && data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error(`Refusing to write ${model} rows for another tenant`);
  }
};

const stampTenant = (data, tenantId, model) => {
  assertSameTenant(data, tenantId, model);
  return { ...data, tenantId };
};

// Pure function: returns the args Prisma should actually run for this tenant.
const scopeArgs = ({ model, operation, args = {} }, tenantId) => {
  if (model === 'Tenant') {
    if (TENANT_OPERATIONS_BLOCKED.has(operation)) {
      throw new Error(`Tenant.${operation} is not allowed on a tenant-scoped client`);
    }
    return { ...args, where: withTenantFilter(args.where, { id: tenantId }) };
  }

  if (!TENANT_SCOPED_MODELS.has(model)) {
    throw new Error(`Model ${model} is not classified in tenantDb.js`);
  }

  const scoped = { ...args };

  if (FILTERED_OPERATIONS.has(operation)) {
    scoped.where = withTenantFilter(args.where, { tenantId });
  }

  switch (operation) {
    case 'create':
      scoped.data = stampTenant(args.data, tenantId, model);
      break;
    case 'createMany':
    case 'createManyAndReturn':
      scoped.data = toArray(args.data).map((row) => stampTenant(row, tenantId, model));
      break;
    case 'upsert':
      scoped.create = stampTenant(args.create, tenantId, model);
      assertSameTenant(args.update, tenantId, model);
      break;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      // Rows can't be moved to another tenant.
      assertSameTenant(args.data, tenantId, model);
      break;
    default:
      break;
  }

  return scoped;
};

const forTenant = (tenantId) => {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error('forTenant() requires a tenantId');
  }

  return prisma.$extends({
    name: 'tenantScope',
    query: {
      async $allOperations({ model, operation, args, query }) {
        if (!model) {
          throw new Error(`${operation} is not tenant-scoped; use the base client deliberately`);
        }
        return query(scopeArgs({ model, operation, args }, tenantId));
      },
    },
  });
};

module.exports = { forTenant, scopeArgs, TENANT_SCOPED_MODELS };
