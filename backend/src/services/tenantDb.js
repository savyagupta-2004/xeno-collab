// Tenant-scoped database access.
//
// forTenant(tenantId) returns a Prisma client where every query is limited to one tenant:
// - reads/updates/deletes get `AND tenantId = <tenantId>` (Tenant itself: `AND id = <tenantId>`)
// - creates get tenantId set, and writing into another tenant throws
// - nested relation reads (`include` / `select`) are scoped too: list relations get the same
//   tenant filter, and a single related record owned by another tenant comes back as null
// - raw SQL is blocked, because it can't be scoped automatically
//
// Which models are tenant-owned is read from the Prisma schema itself (any model with a
// `tenantId` field), so this file can't drift from schema.prisma. A new model that is neither
// Tenant nor has tenantId is rejected until its ownership is handled here.
//
// Not covered: nested writes (e.g. order.create with lineItems: { create: [...] }) must set
// tenantId on the child rows themselves.
const { Prisma } = require('@prisma/client');
const { prisma } = require('../config/prisma');

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));

const TENANT_SCOPED_MODELS = new Set(
  [...MODELS.values()]
    .filter((model) => model.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar'))
    .map((model) => model.name),
);

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

// Operations where `select` means aggregate fields, not relations to load.
const AGGREGATE_OPERATIONS = new Set(['count', 'aggregate', 'groupBy']);

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

const assertKnownModel = (model) => {
  if (model !== 'Tenant' && !TENANT_SCOPED_MODELS.has(model)) {
    throw new Error(`Model ${model} has no tenantId; define its tenant ownership in tenantDb.js`);
  }
};

// The field that says which tenant a row belongs to.
const ownerKey = (model) => (model === 'Tenant' ? 'id' : 'tenantId');

const relationOf = (model, field) => {
  const def = MODELS.get(model)?.fields.find((f) => f.name === field && f.kind === 'object');
  return def ? { target: def.type, isList: def.isList } : null;
};

// Keeps the caller's filter and adds the tenant condition with AND, so a caller can narrow the
// result but never widen it (e.g. asking for another tenant's id simply matches nothing).
const withTenantFilter = (where = {}, model, tenantId) => ({
  ...where,
  AND: [...toArray(where.AND), { [ownerKey(model)]: tenantId }],
});

// Rewrites an `include` / `select` tree so related records are scoped too:
// - list relations get the tenant filter in their own `where`
// - single relations get their owner key selected, so the result can be checked afterwards
const scopeSelection = (model, selection, tenantId) => {
  if (!selection || typeof selection !== 'object') return selection;

  const scoped = { ...selection };
  for (const [field, value] of Object.entries(selection)) {
    if (!value) continue;

    if (field === '_count') {
      scoped._count = scopeCount(model, value, tenantId);
      continue;
    }

    const relation = relationOf(model, field);
    if (!relation) continue;
    assertKnownModel(relation.target);

    const nested = value === true ? {} : { ...value };
    if (relation.isList) {
      nested.where = withTenantFilter(nested.where, relation.target, tenantId);
    } else if (nested.select && !nested.select[ownerKey(relation.target)]) {
      nested.select = { ...nested.select, [ownerKey(relation.target)]: true };
    }
    if (nested.include) nested.include = scopeSelection(relation.target, nested.include, tenantId);
    if (nested.select) nested.select = scopeSelection(relation.target, nested.select, tenantId);

    scoped[field] = Object.keys(nested).length === 0 ? true : nested;
  }
  return scoped;
};

// `_count: true` or `_count: { select: { lineItems: true } }` -> each count gets the tenant filter.
const scopeCount = (model, value, tenantId) => {
  const fields =
    value === true
      ? MODELS.get(model)
          .fields.filter((f) => f.kind === 'object' && f.isList)
          .map((f) => f.name)
      : Object.keys(value.select ?? {}).filter((f) => value.select[f]);

  const select = {};
  for (const field of fields) {
    const relation = relationOf(model, field);
    assertKnownModel(relation.target);
    const option = value.select?.[field];
    const where = option && typeof option === 'object' ? option.where : undefined;
    select[field] = { where: withTenantFilter(where, relation.target, tenantId) };
  }
  return { select };
};

// After the query: a single related record owned by another tenant becomes null (as if it
// didn't exist), and owner keys added only for this check are removed again.
const verifyResult = (model, result, originalSelection, scopedSelection, tenantId) => {
  if (!result || typeof result !== 'object' || !scopedSelection) return result;
  if (Array.isArray(result)) {
    return result.map((row) =>
      verifyResult(model, row, originalSelection, scopedSelection, tenantId),
    );
  }

  const out = { ...result };
  for (const [field, scopedValue] of Object.entries(scopedSelection)) {
    const relation = relationOf(model, field);
    if (!relation || !(field in out) || out[field] === null) continue;

    const originalValue = originalSelection?.[field];
    const nestedScoped = scopedValue === true ? undefined : scopedValue;
    const nestedOriginal = originalValue === true ? undefined : originalValue;
    const key = ownerKey(relation.target);

    if (!relation.isList && out[field][key] !== tenantId) {
      out[field] = null;
      continue;
    }

    out[field] = verifyResult(
      relation.target,
      out[field],
      nestedOriginal?.select ?? nestedOriginal?.include,
      nestedScoped?.select ?? nestedScoped?.include,
      tenantId,
    );

    // Drop the owner key if we only selected it for the check above.
    if (!relation.isList && nestedOriginal?.select && !nestedOriginal.select[key]) {
      out[field] = { ...out[field] };
      delete out[field][key];
    }
  }
  return out;
};

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
  assertKnownModel(model);

  if (model === 'Tenant' && TENANT_OPERATIONS_BLOCKED.has(operation)) {
    throw new Error(`Tenant.${operation} is not allowed on a tenant-scoped client`);
  }

  const scoped = { ...args };

  if (FILTERED_OPERATIONS.has(operation)) {
    scoped.where = withTenantFilter(args.where, model, tenantId);
  }

  if (!AGGREGATE_OPERATIONS.has(operation)) {
    if (args.include) scoped.include = scopeSelection(model, args.include, tenantId);
    if (args.select) scoped.select = scopeSelection(model, args.select, tenantId);
  }

  if (model === 'Tenant') return scoped;

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
        const scoped = scopeArgs({ model, operation, args }, tenantId);
        const result = await query(scoped);
        if (AGGREGATE_OPERATIONS.has(operation)) return result;
        return verifyResult(
          model,
          result,
          args?.select ?? args?.include,
          scoped.select ?? scoped.include,
          tenantId,
        );
      },
    },
  });
};

module.exports = { forTenant, scopeArgs, verifyResult, TENANT_SCOPED_MODELS };
