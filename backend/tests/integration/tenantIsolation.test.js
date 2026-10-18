// Two tenants, each with a customer, product and order. Every API call must only ever see
// the caller's own rows, and another tenant's record must look exactly like a missing one.
const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const createApp = require('../../src/app');

const app = createApp({ nodeEnv: 'test' });

const registerTenant = async (email, storeName) => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Owner', email, password: 'password-123', storeName });
  return { token: res.body.token, tenantId: res.body.tenant.id, userId: res.body.user.id };
};

const seedStore = (tenantId, label) => {
  const customer = fake.insert('customer', {
    tenantId,
    shopifyCustomerId: '1001',
    email: `${label}@buyer.com`,
  });
  const product = fake.insert('product', {
    tenantId,
    shopifyProductId: '2001',
    title: `${label} tee`,
  });
  const order = fake.insert('order', {
    tenantId,
    shopifyOrderId: '3001',
    customerId: customer.id,
    totalPrice: '999.00',
  });
  fake.insert('orderLineItem', {
    tenantId,
    orderId: order.id,
    productId: product.id,
    shopifyLineItemId: '4001',
    title: `${label} tee`,
    quantity: 1,
    price: '999.00',
  });
  return { customer, product, order };
};

const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);

let a;
let b;

beforeEach(async () => {
  fake.reset();
  a = await registerTenant('a@store.com', 'Store A');
  b = await registerTenant('b@store.com', 'Store B');
  a.records = seedStore(a.tenantId, 'a');
  b.records = seedStore(b.tenantId, 'b');
});

describe.each([
  ['customers', 'customer', 'Customer'],
  ['products', 'product', 'Product'],
  ['orders', 'order', 'Order'],
])('GET /api/%s/:id', (path, key, label) => {
  it("returns the caller's own record", async () => {
    const res = await get(`/api/${path}/${a.records[key].id}`, a.token);

    expect(res.status).toBe(200);
    expect(res.body[key]).toMatchObject({ id: a.records[key].id, tenantId: a.tenantId });
  });

  it("returns 404 (not 403) for another tenant's record, identical to a missing one", async () => {
    const otherTenants = await get(`/api/${path}/${b.records[key].id}`, a.token);
    const missing = await get(`/api/${path}/999999`, a.token);

    expect(otherTenants.status).toBe(404);
    expect(otherTenants.body).toEqual({
      error: { message: `${label} not found`, code: 'NOT_FOUND' },
    });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual(otherTenants.body);
  });

  it('works in both directions', async () => {
    const res = await get(`/api/${path}/${a.records[key].id}`, b.token);

    expect(res.status).toBe(404);
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])(
    'returns 404 for an invalid id "%s"',
    async (id) => {
      const res = await get(`/api/${path}/${id}`, a.token);

      expect(res.status).toBe(404);
    },
  );

  it('requires a token', async () => {
    const res = await request(app).get(`/api/${path}/${a.records[key].id}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 TOKEN_EXPIRED for an expired token', async () => {
    const expired = jwt.sign({ userId: a.userId, tenantId: a.tenantId }, process.env.JWT_SECRET, {
      expiresIn: -10,
    });

    const res = await get(`/api/${path}/${a.records[key].id}`, expired);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });
});

it("returns an order with only its own line items, never another tenant's", async () => {
  const res = await get(`/api/orders/${a.records.order.id}`, a.token);

  expect(res.body.order.lineItems).toHaveLength(1);
  expect(res.body.order.lineItems[0]).toMatchObject({ tenantId: a.tenantId, title: 'a tee' });
  expect(JSON.stringify(res.body)).not.toContain(b.tenantId);
});

// Regression: a line item owned by tenant B but attached to tenant A's order (e.g. bad sync
// data) must never come back through GET /api/orders/:id for either tenant.
it("doesn't leak another tenant's line item attached to the caller's order", async () => {
  fake.insert('orderLineItem', {
    tenantId: b.tenantId,
    orderId: a.records.order.id,
    shopifyLineItemId: 'leak',
    title: 'B secret item',
    quantity: 1,
    price: '1.00',
  });

  const res = await get(`/api/orders/${a.records.order.id}`, a.token);

  expect(res.status).toBe(200);
  expect(res.body.order.lineItems.map((item) => item.title)).toEqual(['a tee']);
  expect(JSON.stringify(res.body)).not.toContain('B secret item');
});

it("rejects a forged token that pairs one tenant's user with another tenant", async () => {
  const forged = jwt.sign({ userId: a.userId, tenantId: b.tenantId }, process.env.JWT_SECRET);

  const res = await get(`/api/customers/${b.records.customer.id}`, forged);

  expect(res.status).toBe(401);
});
