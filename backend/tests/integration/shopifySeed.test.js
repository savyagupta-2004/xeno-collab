// Runs the dev-store seeder against an in-memory fake of the Shopify Admin GraphQL API.
const { buildSeedPlan } = require('../../scripts/shopify/seedPlan');
const { seedStore } = require('../../scripts/shopify/seedStore');

const operationName = (query) => /(?:query|mutation)\s+(\w+)/.exec(query)[1];

const createFakeShopify = ({ currencyCode = 'INR' } = {}) => {
  let nextId = 1;
  const gid = (type) => `gid://shopify/${type}/${nextId++}`;
  const store = { products: [], customers: [], orders: [], refunds: [], cancels: [], calls: [] };

  const handlers = {
    SeedShop: () => ({
      shop: { name: 'Demo', currencyCode, myshopifyDomain: 'demo.myshopify.com' },
    }),
    SeedExistingProducts: () => ({ products: { nodes: store.products } }),
    SeedCreateProduct: ({ input }) => {
      const product = {
        id: gid('Product'),
        title: input.title,
        tags: input.tags,
        variants: { nodes: [{ id: gid('ProductVariant'), price: input.variants[0].price }] },
      };
      store.products.push(product);
      return { productSet: { product, userErrors: [] } };
    },
    SeedExistingCustomers: () => ({ customers: { nodes: store.customers } }),
    SeedFindCustomer: ({ query }) => ({
      customers: { nodes: store.customers.filter((c) => query.includes(c.email)) },
    }),
    SeedCreateCustomer: ({ input }) => {
      if (store.customers.some((c) => c.email === input.email)) {
        return {
          customerCreate: {
            customer: null,
            userErrors: [{ field: ['email'], message: 'Email has already been taken' }],
          },
        };
      }
      const customer = { id: gid('Customer'), email: input.email };
      store.customers.push(customer);
      return { customerCreate: { customer, userErrors: [] } };
    },
    SeedExistingOrders: () => ({
      orders: { nodes: store.orders, pageInfo: { hasNextPage: false, endCursor: null } },
    }),
    SeedCreateOrder: ({ order: input, options }) => {
      const variantIds = new Set(store.products.map((p) => p.variants.nodes[0].id));
      if (!input.lineItems.every((l) => variantIds.has(l.variantId)))
        throw new Error('unknown variant');
      if (input.customer && !store.customers.some((c) => c.id === input.customer.toAssociate.id)) {
        throw new Error('unknown customer');
      }
      const order = {
        id: gid('Order'),
        name: `#${1000 + store.orders.length + 1}`,
        tags: input.tags,
        input,
        options,
        transactions: (input.transactions || []).map((t) => ({
          id: gid('OrderTransaction'),
          kind: t.kind,
          gateway: t.gateway,
          amountSet: { shopMoney: { amount: t.amountSet.shopMoney.amount } },
        })),
        lineItems: {
          nodes: input.lineItems.map((l) => ({ id: gid('LineItem'), quantity: l.quantity })),
        },
      };
      store.orders.push(order);
      return { orderCreate: { order, userErrors: [] } };
    },
    SeedRefundOrder: ({ input, key }) => {
      store.refunds.push({ input, key });
      return { refundCreate: { refund: { id: gid('Refund') }, userErrors: [] } };
    },
    SeedCancelOrder: ({ orderId }) => {
      store.cancels.push(orderId);
      return { orderCancel: { job: { id: gid('Job'), done: false }, orderCancelUserErrors: [] } };
    },
    SeedCounts: () => ({
      productsCount: { count: store.products.length },
      customersCount: { count: store.customers.length },
      ordersCount: { count: store.orders.length },
    }),
  };

  const client = {
    graphql: async (query, variables = {}) => {
      const name = operationName(query);
      store.calls.push({ name, query, variables });
      if (!handlers[name]) throw new Error(`No fake handler for ${name}`);
      return handlers[name](variables);
    },
  };

  return { client, store };
};

const plan = buildSeedPlan({ size: 'small', now: new Date('2026-10-22T12:00:00Z') });
const run = (client, extra = {}) =>
  seedStore({ client, plan, log: () => {}, sleep: async () => {}, orderIntervalMs: 0, ...extra });

describe('seedStore', () => {
  it('creates every planned product, customer and order', async () => {
    const { client, store } = createFakeShopify();

    const summary = await run(client);

    expect(summary.products).toEqual({ created: 6, existing: 0 });
    expect(summary.customers).toEqual({ created: 6, existing: 0 });
    expect(summary.orders).toMatchObject({ created: 12, cancelled: 1, refunded: 1, guest: 2 });
    expect(summary.totals).toEqual({ products: 6, customers: 6, orders: 12 });
    expect(store.products.every((p) => p.tags.includes('xeno-seed'))).toBe(true);
  });

  it('backdates orders and never emails the fake customers', async () => {
    const { client, store } = createFakeShopify();
    await run(client);

    store.orders.forEach((order, i) => {
      expect(order.input.processedAt).toBe(plan.orders[i].processedAt);
      expect(order.options).toEqual({ sendReceipt: false, sendFulfillmentReceipt: false });
    });
  });

  it('creates guest checkouts with only an email and no customer', async () => {
    const { client, store } = createFakeShopify();
    await run(client);

    const guests = store.orders.filter((o) => !o.input.customer);
    expect(guests).toHaveLength(2);
    guests.forEach((o) => expect(o.input.email).toMatch(/^guest\.\d{3}@example\.com$/));
  });

  it('refunds paid orders against their sale transaction with an idempotency key', async () => {
    const { client, store } = createFakeShopify();
    await run(client);

    const [{ input, key }] = store.refunds;
    const order = store.orders.find((o) => o.id === input.orderId);
    expect(input.transactions[0]).toMatchObject({
      parentId: order.transactions[0].id,
      kind: 'REFUND',
      gateway: 'manual',
      amount: order.transactions[0].amountSet.shopMoney.amount,
    });
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store.calls.find((c) => c.name === 'SeedRefundOrder').query).toContain(
      '@idempotent(key: $key)',
    );
  });

  it('cancels unpaid orders', async () => {
    const { client, store } = createFakeShopify();
    await run(client);

    const cancelled = store.orders.find((o) => o.id === store.cancels[0]);
    expect(cancelled.input.financialStatus).toBe('PENDING');
    expect(cancelled.input.transactions).toBeUndefined();
  });

  it('is safe to re-run: an interrupted run continues without duplicates', async () => {
    const { client, store } = createFakeShopify();
    await run(client);
    store.orders.splice(8); // pretend the first run stopped after 8 orders

    const summary = await run(client);

    expect(summary.products).toEqual({ created: 0, existing: 6 });
    expect(summary.customers).toEqual({ created: 0, existing: 6 });
    expect(summary.orders).toMatchObject({ created: 4, existing: 8 });
    expect(store.orders).toHaveLength(12);
  });

  it('refuses to seed a store that is not in INR', async () => {
    const { client, store } = createFakeShopify({ currencyCode: 'USD' });

    await expect(run(client)).rejects.toThrow('INR-only');
    expect(store.products).toHaveLength(0);
  });

  it('waits between orders to respect the dev-store limit of 5 orders per minute', async () => {
    const { client } = createFakeShopify();
    const sleep = jest.fn(async () => {});

    await run(client, { sleep, orderIntervalMs: 12_500 });

    expect(sleep).toHaveBeenCalledTimes(11);
    sleep.mock.calls.forEach(([ms]) => expect(ms).toBeGreaterThan(12_000));
  });
});
