// In-memory stand-in for the parts of Prisma the auth code uses, so tests run without Postgres.
// It mimics the behaviour that matters: `select`, unique constraints (P2002 with the same
// `meta` shape real Prisma returns on PostgreSQL) and transactions that roll back on error.
const { randomUUID } = require('crypto');

const db = { tenants: [], users: [] };

// Real Prisma on PostgreSQL: { code: 'P2002', meta: { modelName: 'User', target: ['email'] } }
const uniqueViolation = (modelName, column) => {
  const err = new Error(`Unique constraint failed on the fields: (\`${column}\`)`);
  err.code = 'P2002';
  err.meta = { modelName, target: [column] };
  return err;
};

const pick = (row, select) => {
  if (!row) return null;
  if (!select) return { ...row };
  const out = {};
  for (const [key, value] of Object.entries(select)) {
    if (value && typeof value === 'object' && value.select) out[key] = pick(row[key], value.select);
    else if (value) out[key] = row[key];
  }
  return out;
};

const withTenant = (user) => ({ ...user, tenant: db.tenants.find((t) => t.id === user.tenantId) });

const prisma = {
  tenant: {
    create: async ({ data, select }) => {
      const row = {
        id: randomUUID(),
        shopDomain: null,
        shopifyAccessToken: null,
        isActive: true,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      if (row.shopDomain && db.tenants.some((t) => t.shopDomain === row.shopDomain)) {
        throw uniqueViolation('Tenant', 'shop_domain');
      }
      db.tenants.push(row);
      return pick(row, select);
    },
    findUnique: async ({ where, select }) =>
      pick(
        db.tenants.find((t) => t.id === where.id),
        select,
      ),
  },
  user: {
    create: async ({ data, select }) => {
      if (db.users.some((u) => u.email === data.email)) {
        throw uniqueViolation('User', 'email');
      }
      const row = {
        id: randomUUID(),
        name: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      db.users.push(row);
      return pick(row, select);
    },
    findUnique: async ({ where, select }) => {
      const user = db.users.find((u) => u.email === where.email);
      return user ? pick(withTenant(user), select) : null;
    },
    findFirst: async ({ where, select }) => {
      const user = db.users.find((u) => u.id === where.id && u.tenantId === where.tenantId);
      return user ? pick(withTenant(user), select) : null;
    },
  },
  $transaction: async (fn) => {
    const snapshot = { tenants: [...db.tenants], users: [...db.users] };
    try {
      return await fn(prisma);
    } catch (err) {
      db.tenants = snapshot.tenants;
      db.users = snapshot.users;
      throw err;
    }
  },
};

const reset = () => {
  db.tenants = [];
  db.users = [];
};

module.exports = { prisma, db, reset, uniqueViolation };
