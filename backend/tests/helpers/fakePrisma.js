// In-memory stand-in for the parts of Prisma the app uses, so tests run without Postgres.
// It mimics the behaviour that matters:
// - `where` filters (equality, AND, OR), `select` / `include` with relations, `orderBy` on one field
// - unique constraints (P2002 with the same `meta` shape real Prisma returns on PostgreSQL)
// - transactions that roll back on error
// - `$extends({ query: { $allOperations } })`, so the real tenant-scoping extension runs in tests
const { randomUUID } = require('crypto');

let nextId = 1;
const uuid = () => ({ id: randomUUID() });
const serial = () => ({ id: nextId++ });
const timestamps = () => ({ createdAt: new Date(), updatedAt: new Date() });

// Prisma client property -> table config
const MODELS = {
  tenant: {
    name: 'Tenant',
    table: 'tenants',
    unique: [['shopDomain', 'shop_domain']],
    defaults: () => ({
      ...uuid(),
      shopDomain: null,
      shopifyAccessToken: null,
      isActive: true,
      lastSyncedAt: null,
      ...timestamps(),
    }),
  },
  user: {
    name: 'User',
    table: 'users',
    unique: [['email', 'email']],
    defaults: () => ({ ...uuid(), name: null, ...timestamps() }),
  },
  customer: { name: 'Customer', table: 'customers', unique: [], defaults: serial },
  product: { name: 'Product', table: 'products', unique: [], defaults: serial },
  order: { name: 'Order', table: 'orders', unique: [], defaults: serial },
  orderLineItem: { name: 'OrderLineItem', table: 'orderLineItems', unique: [], defaults: serial },
};

// model -> relation field -> how to resolve it
const RELATIONS = {
  user: { tenant: { model: 'tenant', local: 'tenantId', foreign: 'id', many: false } },
  order: {
    lineItems: { model: 'orderLineItem', local: 'id', foreign: 'orderId', many: true },
    customer: { model: 'customer', local: 'customerId', foreign: 'id', many: false },
  },
};

const db = Object.fromEntries(Object.values(MODELS).map(({ table }) => [table, []]));

const uniqueViolation = (modelName, column) => {
  const err = new Error(`Unique constraint failed on the fields: (\`${column}\`)`);
  err.code = 'P2002';
  err.meta = { modelName, target: [column] };
  return err;
};

const matches = (row, where = {}) =>
  Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return [].concat(value).every((w) => matches(row, w));
    if (key === 'OR') return [].concat(value).some((w) => matches(row, w));
    return row[key] === value;
  });

const related = (modelKey, row, field) => {
  const rel = RELATIONS[modelKey]?.[field];
  if (!rel) throw new Error(`fakePrisma: unknown relation ${modelKey}.${field}`);
  const rows = db[MODELS[rel.model].table].filter((r) => r[rel.foreign] === row[rel.local]);
  return { rel, rows: rel.many ? rows : (rows[0] ?? null) };
};

const sortBy = (rows, orderBy) => {
  if (!orderBy) return rows;
  const [[field, direction]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => (a[field] > b[field] ? 1 : -1) * (direction === 'desc' ? -1 : 1));
};

const shapeRelation = (relModelKey, value, options) => {
  if (value === null) return null;
  const opts = options === true ? {} : options;
  if (Array.isArray(value)) {
    return sortBy(value, opts.orderBy)
      .filter((r) => matches(r, opts.where))
      .map((r) => shape(relModelKey, r, opts));
  }
  return shape(relModelKey, value, opts);
};

// Applies `select` or `include` like Prisma does.
function shape(modelKey, row, { select, include } = {}) {
  if (!row) return null;
  if (select) {
    const out = {};
    for (const [field, option] of Object.entries(select)) {
      if (!option) continue;
      if (RELATIONS[modelKey]?.[field]) {
        const { rel, rows } = related(modelKey, row, field);
        out[field] = shapeRelation(rel.model, rows, option);
      } else out[field] = row[field];
    }
    return out;
  }
  const out = { ...row };
  for (const [field, option] of Object.entries(include ?? {})) {
    if (!option) continue;
    const { rel, rows } = related(modelKey, row, field);
    out[field] = shapeRelation(rel.model, rows, option);
  }
  return out;
}

const delegate = (modelKey) => {
  const { name, table, unique, defaults } = MODELS[modelKey];
  const rows = () => db[table];

  return {
    create: async ({ data, select, include }) => {
      const row = { ...defaults(), ...(modelKey === 'tenant' ? {} : timestamps()), ...data };
      for (const [field, column] of unique) {
        if (row[field] != null && rows().some((r) => r[field] === row[field])) {
          throw uniqueViolation(name, column);
        }
      }
      rows().push(row);
      return shape(modelKey, row, { select, include });
    },
    findUnique: async ({ where, select, include }) =>
      shape(
        modelKey,
        rows().find((r) => matches(r, where)),
        { select, include },
      ),
    findFirst: async ({ where, select, include, orderBy } = {}) =>
      shape(
        modelKey,
        sortBy(rows(), orderBy).find((r) => matches(r, where)),
        { select, include },
      ),
    findMany: async ({ where, select, include, orderBy } = {}) =>
      sortBy(rows(), orderBy)
        .filter((r) => matches(r, where))
        .map((r) => shape(modelKey, r, { select, include })),
    count: async ({ where } = {}) => rows().filter((r) => matches(r, where)).length,
  };
};

const prisma = Object.fromEntries(Object.keys(MODELS).map((key) => [key, delegate(key)]));

prisma.$queryRaw = async () => [];

prisma.$transaction = async (fn) => {
  const snapshot = Object.fromEntries(Object.entries(db).map(([t, r]) => [t, [...r]]));
  try {
    return await fn(prisma);
  } catch (err) {
    Object.assign(db, snapshot);
    throw err;
  }
};

// Mirrors Prisma's query extension hook: every model operation (and raw queries, with
// model undefined) goes through $allOperations before reaching the base delegate.
prisma.$extends = ({ query: { $allOperations } = {} } = {}) => {
  if (!$allOperations) return prisma;
  const extended = {};
  for (const key of Object.keys(MODELS)) {
    extended[key] = {};
    for (const operation of Object.keys(prisma[key])) {
      extended[key][operation] = (args = {}) =>
        $allOperations({
          model: MODELS[key].name,
          operation,
          args,
          query: (scopedArgs) => prisma[key][operation](scopedArgs),
        });
    }
  }
  extended.$queryRaw = (...args) =>
    $allOperations({ model: undefined, operation: '$queryRaw', args, query: () => [] });
  extended.$transaction = (fn) => prisma.$transaction(() => fn(extended));
  return extended;
};

// Inserts a row directly (test setup), applying the same defaults as create().
const insert = (modelKey, data) => {
  const row = { ...MODELS[modelKey].defaults(), ...timestamps(), ...data };
  db[MODELS[modelKey].table].push(row);
  return row;
};

const reset = () => {
  for (const table of Object.keys(db)) db[table] = [];
  nextId = 1;
};

module.exports = { prisma, db, reset, insert, uniqueViolation };
