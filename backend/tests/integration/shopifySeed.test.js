// Runs the dev-store seeder against an in-memory fake of the Shopify Admin GraphQL API.
const { ShopifyError } = require('../../scripts/shopify/client');
const { buildSeedPlan } = require('../../scripts/shopify/seedPlan');
const { seedStore } = require('../../scripts/shopify/seedStore');

const operationName = (query) => /(?:query|mutation)\s+(\w+)/.exec(query)[1];

// cancelJob: 'succeed' (done after 2 polls), 'fail', or 'never' (stays running)
const createFakeShopify = ({ currencyCode = 'INR', cancelJob = 'succeed' } = {}) => {
  let nextId = 1;
  const gid = (type) => `gid://shopify/${type}/${nextId++}`;
  const store = {
    products: [],
    customers: [],
    orders: [],
    jobs: new Map(),
    refundKeys: new Map(),
    calls: [],
    faults: [],
  };

  const toNode = (order) => ({
    id: order.id,
    name: order.name,
    tags: order.tags,
    cancelledAt: order.cancelledAt,
    transactions: order.transactions,
    lineItems: order.lineItems,
    refunds: order.refunds.map((id) => ({ id })),
  });

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
    SeedExistingOrders: ({ first, cursor }) => {
      const start = cursor ? Number(cursor) : 0;
      const page = store.orders.slice(start, start + first);
      const end = start + page.length;
      return {
        orders: {
          nodes: page.map(toNode),
          pageInfo: { hasNextPage: end < store.orders.length, endCursor: String(end) },
        },
      };
    },
    SeedCreateOrder: ({ order: input, options }) => {
      const variantIds = new Set(store.products.map((p) => p.variants.nodes[0].id));
      if (!input.lineItems.every((l) => variantIds.has(l.variantId))) {
        throw new Error('unknown variant');
      }
      if (input.customer && !store.customers.some((c) => c.id === input.customer.toAssociate.id)) {
        throw new Error('unknown customer');
      }
      const order = {
        id: gid('Order'),
        name: `#${1000 + store.orders.length + 1}`,
        tags: input.tags,
        input,
        options,
        cancelledAt: null,
        refunds: [],
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
      return { orderCreate: { order: toNode(order), userErrors: [] } };
    },
    SeedRefundOrder: ({ input, key }) => {
      const order = store.orders.find((o) => o.id === input.orderId);
      // Same idempotency key = same refund: Shopify returns it instead of refunding again.
      if (!store.refundKeys.has(key)) {
        const refundId = gid('Refund');
        store.refundKeys.set(key, { refundId, input });
        order.refunds.push(refundId);
      }
      return {
        refundCreate: { refund: { id: store.refundKeys.get(key).refundId }, userErrors: [] },
      };
    },
    SeedCancelOrder: ({ orderId }) => {
      const job = {
        id: gid('OrderCancelJobResult'),
        orderId,
        polls: 0,
        done: false,
        status: 'STARTED',
      };
      store.jobs.set(job.id, job);
      return {
        orderCancel: {
          jobResult: { id: job.id, done: false, status: 'STARTED' },
          orderCancelUserErrors: [],
        },
      };
    },
    SeedCancelJobStatus: ({ id }) => {
      const job = store.jobs.get(id);
      job.polls += 1;
      if (cancelJob === 'succeed' && job.polls >= 2) {
        Object.assign(job, { done: true, status: 'SUCCEEDED' });
        store.orders.find((o) => o.id === job.orderId).cancelledAt = '2026-10-28T10:00:00Z';
      }
      if (cancelJob === 'fail' && job.polls >= 2) {
        Object.assign(job, {
          done: true,
          status: 'FAILED',
          errors: [{ field: null, message: 'Order has open fulfillments', code: 'INVALID' }],
        });
      }
      return { node: { done: job.done, status: job.status, errors: job.errors || [] } };
    },
    SeedOrderCancelledAt: ({ id }) => {
      const order = store.orders.find((o) => o.id === id);
      return { order: order && { id, cancelledAt: order.cancelledAt } };
    },
    SeedCounts: () => ({
      productsCount: { count: store.products.length },
      customersCount: { count: store.customers.length },
      ordersCount: { count: store.orders.length },
    }),
  };

  // Fault injection: { op, when: 'lost-reply' (applied, reply lost) | 'no-reply' (not applied)
  // | 'crash' (plain error, like the script dying), times }
  const client = {
    graphql: async (query, variables = {}, options = {}) => {
      const name = operationName(query);
      store.calls.push({ name, query, variables, options });
      const fault = store.faults.find((f) => f.op === name && f.times > 0);
      if (fault) fault.times -= 1;
      if (fault?.when === 'no-reply' || fault?.when === 'crash') {
        throw Object.assign(new ShopifyError(`simulated ${fault.when}`), {
          outcomeUnknown: fault.when === 'no-reply',
        });
      }
      if (!handlers[name]) throw new Error(`No fake handler for ${name}`);
      const result = handlers[name](variables);
      if (fault?.when === 'lost-reply') {
        throw Object.assign(new ShopifyError('simulated lost reply'), { outcomeUnknown: true });
      }
      return result;
    },
  };

  return { client, store };
};

const plan = buildSeedPlan({ size: 'small', now: new Date('2026-10-22T12:00:00Z') });
const run = (client, extra = {}) =>
  seedStore({
    client,
    plan,
    log: () => {},
    sleep: async () => {},
    orderIntervalMs: 0,
    ...extra,
  });

const mutationCalls = (store) =>
  store.calls.filter((c) => /^Seed(Create|Refund|Cancel)(Product|Customer|Order)$/.test(c.name));

describe('seedStore: first run', () => {
  it('creates every planned product, customer and order', async () => {
    const { client, store } = createFakeShopify();

    const summary = await run(client);

    expect(summary.products).toEqual({ created: 6, existing: 0 });
    expect(summary.customers).toEqual({ created: 6, existing: 0 });
    expect(summary.orders).toMatchObject({
      created: 12,
      existing: 0,
      cancelled: 1,
      refunded: 1,
      guest: 2,
      repaired: 0,
      duplicates: 0,
    });
    expect(summary.totals).toEqual({ products: 6, customers: 6, orders: 12 });
    expect(store.orders.every((o) => o.tags.includes('xeno-seed-plan:small-42'))).toBe(true);
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

    const [[key, { input }]] = [...store.refundKeys];
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

  it('refuses to seed a store that is not in INR', async () => {
    const { client, store } = createFakeShopify({ currencyCode: 'USD' });

    await expect(run(client)).rejects.toThrow('INR-only');
    expect(store.products).toHaveLength(0);
  });

  it('waits between orders to respect the dev-store limit of 5 orders per minute', async () => {
    const { client } = createFakeShopify();
    const sleep = jest.fn(async () => {});

    await run(client, { sleep, orderIntervalMs: 12_500 });

    const orderWaits = sleep.mock.calls.filter(([ms]) => ms > 12_000);
    expect(orderWaits).toHaveLength(11);
  });

  it('pages through existing orders (main store has 55)', async () => {
    const { client, store } = createFakeShopify();
    const fullPlan = buildSeedPlan({ size: 'full', now: new Date('2026-10-22T12:00:00Z') });

    await seedStore({
      client,
      plan: fullPlan,
      log: () => {},
      sleep: async () => {},
      orderIntervalMs: 0,
    });
    store.calls.length = 0;
    const second = await seedStore({
      client,
      plan: fullPlan,
      log: () => {},
      sleep: async () => {},
      orderIntervalMs: 0,
    });

    expect(second.orders).toMatchObject({ created: 0, existing: 55 });
    expect(store.calls.filter((c) => c.name === 'SeedExistingOrders')).toHaveLength(3);
  });
});

describe('seedStore: cancellation waits for the Shopify job (review comment 1)', () => {
  it('polls the cancel job until it finishes and confirms cancelledAt before counting it', async () => {
    const { client, store } = createFakeShopify();

    const summary = await run(client);

    const names = store.calls.map((c) => c.name);
    const start = names.indexOf('SeedCancelOrder');
    const polls = names.slice(start).filter((n) => n === 'SeedCancelJobStatus');
    expect(polls).toHaveLength(2); // STARTED, then SUCCEEDED
    expect(names.slice(start).lastIndexOf('SeedOrderCancelledAt')).toBeGreaterThan(
      names.slice(start).lastIndexOf('SeedCancelJobStatus'),
    );
    expect(summary.orders.cancelled).toBe(1);
    expect(store.orders.filter((o) => o.cancelledAt)).toHaveLength(1);
  });

  it('fails loudly (and counts nothing) when the cancel job fails', async () => {
    const { client, store } = createFakeShopify({ cancelJob: 'fail' });

    await expect(run(client)).rejects.toThrow('failed: Order has open fulfillments');
    expect(store.orders.filter((o) => o.cancelledAt)).toHaveLength(0);
  });

  it('stops with a clear message if the job never finishes; a re-run completes it', async () => {
    const fake = createFakeShopify({ cancelJob: 'never' });

    await expect(run(fake.client)).rejects.toThrow("hasn't finished yet. Re-run the seeder");
    expect(fake.store.orders.filter((o) => o.cancelledAt)).toHaveLength(0);
  });
});

describe('seedStore: re-running is safe (review comment 2)', () => {
  it('a second run creates and changes nothing', async () => {
    const { client, store } = createFakeShopify();
    await run(client);
    const snapshot = JSON.stringify(store.orders);
    store.calls.length = 0;

    const summary = await run(client);

    expect(summary.products).toEqual({ created: 0, existing: 6 });
    expect(summary.customers).toEqual({ created: 0, existing: 6 });
    expect(summary.orders).toMatchObject({ created: 0, existing: 12, repaired: 0 });
    expect(mutationCalls(store)).toEqual([]);
    expect(JSON.stringify(store.orders)).toBe(snapshot);
  });

  it('an interrupted run continues without duplicates', async () => {
    const { client, store } = createFakeShopify();
    await run(client);
    store.orders.splice(8); // pretend the first run stopped after 8 orders

    const summary = await run(client);

    expect(summary.orders).toMatchObject({ created: 4, existing: 8 });
    expect(store.orders).toHaveLength(12);
  });

  it('finishes a refund that a crashed run never got to', async () => {
    const { client, store } = createFakeShopify();
    store.faults.push({ op: 'SeedRefundOrder', when: 'crash', times: 1 });
    await expect(run(client)).rejects.toThrow('simulated crash');
    const refundedOrderKey = plan.orders.find((o) => o.outcome === 'refunded').key;
    const order = store.orders.find((o) => o.tags.includes(`xeno-seed-key:${refundedOrderKey}`));
    expect(order.refunds).toHaveLength(0);

    const summary = await run(client);

    expect(summary.orders).toMatchObject({ repaired: 1, refunded: 1 });
    expect(order.refunds).toHaveLength(1);
    expect(store.orders).toHaveLength(12);
  });

  it('finishes a cancellation that a crashed run never got to', async () => {
    const { client, store } = createFakeShopify();
    store.faults.push({ op: 'SeedCancelOrder', when: 'crash', times: 1 });
    await expect(run(client)).rejects.toThrow('simulated crash');

    const summary = await run(client);

    expect(summary.orders).toMatchObject({ repaired: 1, cancelled: 1 });
    expect(store.orders.filter((o) => o.cancelledAt)).toHaveLength(1);
  });

  it('does not duplicate an order when Shopify created it but the reply was lost', async () => {
    const { client, store } = createFakeShopify();
    store.faults.push({ op: 'SeedCreateOrder', when: 'lost-reply', times: 1 });

    const summary = await run(client);

    expect(store.orders).toHaveLength(12);
    expect(summary.orders.created).toBe(12);
  });

  it('retries once when the order was not created', async () => {
    const { client, store } = createFakeShopify();
    store.faults.push({ op: 'SeedCreateOrder', when: 'no-reply', times: 1 });

    await run(client);

    expect(store.orders).toHaveLength(12);
  });

  it('does not duplicate products or customers after a lost reply', async () => {
    const { client, store } = createFakeShopify();
    store.faults.push({ op: 'SeedCreateProduct', when: 'lost-reply', times: 1 });
    store.faults.push({ op: 'SeedCreateCustomer', when: 'lost-reply', times: 1 });

    await run(client);

    expect(store.products).toHaveLength(6);
    expect(store.customers).toHaveLength(6);
  });

  it('never lets the client blindly retry mutations Shopify cannot deduplicate', async () => {
    const { client, store } = createFakeShopify();
    await run(client);

    const flags = Object.fromEntries(store.calls.map((c) => [c.name, c.options.idempotent]));
    expect(flags).toMatchObject({
      SeedCreateProduct: false,
      SeedCreateCustomer: false,
      SeedCreateOrder: false,
      SeedCancelOrder: false,
    });
    // refundCreate is deduplicated by its idempotency key, so retrying it is safe.
    expect(flags.SeedRefundOrder).toBeUndefined();
  });

  it('refuses to mix a different plan into an already seeded store', async () => {
    const { client } = createFakeShopify();
    await run(client);

    const otherPlan = buildSeedPlan({ size: 'full', now: new Date('2026-10-22T12:00:00Z') });
    await expect(
      seedStore({
        client,
        plan: otherPlan,
        log: () => {},
        sleep: async () => {},
        orderIntervalMs: 0,
      }),
    ).rejects.toThrow('seeded with plan "small-42", not "full-42"');
  });

  it('accepts orders seeded before plan tags existed', async () => {
    const { client, store } = createFakeShopify();
    await run(client);
    store.orders.forEach((o) => {
      o.tags = o.tags.filter((t) => !t.startsWith('xeno-seed-plan:'));
    });

    await expect(run(client)).resolves.toMatchObject({ orders: { created: 0, existing: 12 } });
  });

  it('reports duplicate seeded orders without touching them', async () => {
    const { client, store } = createFakeShopify();
    await run(client);
    store.orders.push({ ...store.orders[0], id: 'gid://shopify/Order/dup', name: '#dup' });
    const logs = [];

    const summary = await run(client, { log: (line) => logs.push(line) });

    expect(summary.orders.duplicates).toBe(1);
    expect(logs.some((l) => l.includes('2 orders share key order-001'))).toBe(true);
    expect(store.orders).toHaveLength(13);
  });
});
