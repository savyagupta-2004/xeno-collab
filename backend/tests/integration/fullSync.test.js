// The first full sync against a mocked Shopify and the in-memory database.
jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const { isSyncing, triggerFullSync } = require('../../src/services/sync.service');
const { encryptToken } = require('../../src/utils/tokenCipher');

const TOKEN = 'shpat_sync_secret';
const gid = (type, id) => `gid://shopify/${type}/${id}`;
const money = (amount) => ({ shopMoney: { amount } });

const customerNode = (id, overrides = {}) => ({
  id: gid('Customer', id),
  firstName: 'Asha',
  lastName: 'Rao',
  defaultEmailAddress: { emailAddress: `c${id}@example.com` },
  defaultPhoneNumber: null,
  numberOfOrders: '2',
  amountSpent: { amount: '1998.00' },
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
  ...overrides,
});

const productNode = (id) => ({
  id: gid('Product', id),
  title: `Product ${id}`,
  vendor: 'Xeno Demo',
  productType: '',
  status: 'ACTIVE',
  priceRangeV2: { minVariantPrice: { amount: '499.00' } },
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-02T10:00:00Z',
});

const lineItemNode = (id, productId) => ({
  id: gid('LineItem', id),
  title: 'Tee',
  variantTitle: null,
  sku: null,
  quantity: 2,
  originalUnitPriceSet: money('499.00'),
  product: productId ? { id: gid('Product', productId) } : null,
});

const orderNode = (id, overrides = {}) => ({
  id: gid('Order', id),
  name: `#${1000 + id}`,
  email: 'buyer@example.com',
  customer: { id: gid('Customer', 1) },
  subtotalPriceSet: money('998.00'),
  totalDiscountsSet: money('0.00'),
  totalTaxSet: money('0.00'),
  totalPriceSet: money('998.00'),
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  cancelledAt: null,
  processedAt: '2026-09-10T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  lineItems: { nodes: [lineItemNode(id * 10, 1)], pageInfo: { hasNextPage: false } },
  ...overrides,
});

// Serves `connection` from the operation name, one page at a time.
const shopifyStore = (records, { failOn } = {}) => {
  const respond = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  });
  const page = (items, { first, after }) => {
    const start = after ? Number(after) : 0;
    const end = start + first;
    return {
      nodes: items.slice(start, end),
      pageInfo: { hasNextPage: end < items.length, endCursor: String(end) },
    };
  };

  return jest.fn(async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const operation = /query (\w+)/.exec(query)[1];
    if (operation === failOn) {
      return respond({ errors: [{ message: 'Access denied for customers' }] });
    }
    if (operation === 'SyncCustomers') {
      return respond({ data: { customers: page(records.customers, variables) } });
    }
    if (operation === 'SyncProducts') {
      return respond({ data: { products: page(records.products, variables) } });
    }
    if (operation === 'SyncOrders') {
      return respond({ data: { orders: page(records.orders, variables) } });
    }
    return respond({
      data: { order: { lineItems: page(records.orderLineItems[variables.id], variables) } },
    });
  });
};

const connectedTenant = () => {
  const tenant = fake.insert('tenant', { name: 'Store', shopDomain: 'demo.myshopify.com' });
  tenant.shopifyAccessToken = encryptToken(TOKEN, tenant.id);
  return tenant;
};

const syncToEnd = async (tenantId) => {
  expect(triggerFullSync(tenantId)).toBe(true);
  while (isSyncing(tenantId)) await new Promise((resolve) => setImmediate(resolve));
};

let shopify;
const useShopify = (records, options) => {
  shopify = shopifyStore(records, options);
  jest.spyOn(global, 'fetch').mockImplementation((...args) => shopify(...args));
};

beforeEach(() => {
  fake.reset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('full sync', () => {
  const records = {
    customers: [customerNode(1), customerNode(2)],
    products: [productNode(1)],
    orders: [
      orderNode(1),
      orderNode(2, { customer: null, displayFinancialStatus: 'REFUNDED' }),
      orderNode(3, { cancelledAt: '2026-09-11T10:00:00Z' }),
    ],
  };

  it('stores customers, products, orders and line items for the tenant', async () => {
    const tenant = connectedTenant();
    useShopify(records);

    await syncToEnd(tenant.id);

    expect(fake.db.customers).toHaveLength(2);
    expect(fake.db.customers[0]).toMatchObject({
      tenantId: tenant.id,
      shopifyCustomerId: '1',
      email: 'c1@example.com',
      ordersCount: 2,
      totalSpent: '1998.00',
      createdAt: '2026-09-01T10:00:00Z',
    });
    expect(fake.db.products[0]).toMatchObject({
      shopifyProductId: '1',
      productType: null,
      status: 'active',
      price: '499.00',
    });
    expect(fake.db.orders).toHaveLength(3);
    expect(fake.db.orderLineItems).toHaveLength(3);
    expect(fake.db.orderLineItems[0]).toMatchObject({
      tenantId: tenant.id,
      orderId: fake.db.orders[0].id,
      productId: fake.db.products[0].id,
      shopifyProductId: '1',
      quantity: 2,
      price: '499.00',
    });
  });

  it('links orders to customers and keeps guest and cancelled orders', async () => {
    const tenant = connectedTenant();
    useShopify(records);

    await syncToEnd(tenant.id);

    const [paid, guest, cancelled] = fake.db.orders;
    expect(paid).toMatchObject({
      shopifyOrderId: '1',
      orderNumber: '#1001',
      customerId: fake.db.customers[0].id,
      totalPrice: '998.00',
      financialStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
    });
    expect(guest).toMatchObject({ customerId: null, financialStatus: 'refunded' });
    expect(cancelled.cancelledAt).toBe('2026-09-11T10:00:00Z');
  });

  it('uses processedAt as the order date, so back-dated orders chart correctly', async () => {
    const tenant = connectedTenant();
    useShopify(records);

    await syncToEnd(tenant.id);

    expect(fake.db.orders[0].createdAt).toBe('2026-09-10T10:00:00Z');
  });

  it('creates no duplicates when it runs again, and picks up changes', async () => {
    const tenant = connectedTenant();
    useShopify(records);
    await syncToEnd(tenant.id);

    useShopify({
      ...records,
      customers: [customerNode(1, { firstName: 'Changed' }), customerNode(2)],
    });
    await syncToEnd(tenant.id);

    expect(fake.db.customers).toHaveLength(2);
    expect(fake.db.products).toHaveLength(1);
    expect(fake.db.orders).toHaveLength(3);
    expect(fake.db.orderLineItems).toHaveLength(3);
    expect(fake.db.customers[0].firstName).toBe('Changed');
  });

  it('keeps tenants apart when two stores share Shopify ids', async () => {
    const first = connectedTenant();
    const second = fake.insert('tenant', { name: 'Other', shopDomain: 'other.myshopify.com' });
    second.shopifyAccessToken = encryptToken(TOKEN, second.id);
    useShopify(records);

    await syncToEnd(first.id);
    await syncToEnd(second.id);

    expect(fake.db.customers).toHaveLength(4);
    expect(fake.db.customers.filter((c) => c.tenantId === second.id)).toHaveLength(2);
  });

  it('fetches every line item when an order has more than one page of them', async () => {
    const tenant = connectedTenant();
    const allItems = Array.from({ length: 23 }, (_, i) => lineItemNode(100 + i, 1));
    useShopify({
      ...records,
      orders: [
        orderNode(1, {
          lineItems: { nodes: allItems.slice(0, 20), pageInfo: { hasNextPage: true } },
        }),
      ],
      orderLineItems: { [gid('Order', 1)]: allItems },
    });

    await syncToEnd(tenant.id);

    expect(fake.db.orderLineItems).toHaveLength(23);
  });

  it('sends the decrypted token to Shopify and records each step', async () => {
    const tenant = connectedTenant();
    useShopify(records);

    await syncToEnd(tenant.id);

    expect(shopify.mock.calls[0][1].headers['X-Shopify-Access-Token']).toBe(TOKEN);
    expect(fake.db.syncLogs.map((log) => [log.resource, log.status, log.recordsSynced])).toEqual([
      ['CUSTOMERS', 'SUCCESS', 2],
      ['PRODUCTS', 'SUCCESS', 1],
      ['ORDERS', 'SUCCESS', 3],
    ]);
    expect(fake.db.syncLogs.every((log) => log.tenantId === tenant.id && log.trigger)).toBe(true);
    expect(fake.db.tenants[0].lastSyncedAt).toBeInstanceOf(Date);
  });

  it('records a failure, stops, and leaves lastSyncedAt empty', async () => {
    const tenant = connectedTenant();
    useShopify(records, { failOn: 'SyncProducts' });

    await syncToEnd(tenant.id);

    expect(fake.db.syncLogs.map((log) => [log.resource, log.status])).toEqual([
      ['CUSTOMERS', 'SUCCESS'],
      ['PRODUCTS', 'FAILED'],
    ]);
    expect(fake.db.syncLogs[1].errorMessage).toContain('Access denied');
    expect(fake.db.orders).toHaveLength(0);
    expect(fake.db.tenants[0].lastSyncedAt).toBeNull();
  });

  it('does not start a second sync while one is running', async () => {
    const tenant = connectedTenant();
    useShopify(records);

    triggerFullSync(tenant.id);
    expect(isSyncing(tenant.id)).toBe(true);
    triggerFullSync(tenant.id);
    while (isSyncing(tenant.id)) await new Promise((resolve) => setImmediate(resolve));

    expect(fake.db.syncLogs).toHaveLength(3);
  });

  it('never writes the token to sync logs', async () => {
    const tenant = connectedTenant();
    useShopify(records, { failOn: 'SyncCustomers' });

    await syncToEnd(tenant.id);

    expect(JSON.stringify(fake.db.syncLogs)).not.toContain(TOKEN);
  });
});
