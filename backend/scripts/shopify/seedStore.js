// Creates the seed plan's products, customers and orders in a Shopify dev store.
//
// Re-running is safe:
// - everything is tagged; existing products, customers and orders are reused, never recreated,
//   modified or deleted
// - an interrupted run continues where it stopped, and also finishes orders it created but
//   didn't get to refund or cancel
// - mutations Shopify can't deduplicate (orderCreate, productSet, customerCreate, orderCancel)
//   are never blindly retried: if a reply is lost, the record is looked up first
// - refunds use idempotency keys, so a refund can't happen twice
// - a store seeded with one plan (--size/--seed) refuses a different plan instead of mixing them
const { createHash } = require('crypto');
const { assertNoUserErrors, ShopifyError } = require('./client');
const { SEED_TAG } = require('./seedPlan');

// Dev stores accept at most 5 new orders per minute (orderCreate docs), so space them out.
const ORDER_INTERVAL_MS = 12_500;
const ORDER_LIMIT_RETRY_MS = 60_000;
const MAX_ORDER_ATTEMPTS = 3;
// After a lost reply, Shopify's search can take a few seconds to show the new record.
const LOOKUP_DELAYS_MS = [5_000, 10_000, 20_000];
// Order cancellation is an asynchronous job; poll it for up to ~1 minute.
const CANCEL_POLL_DELAYS_MS = [
  1_000, 1_000, 2_000, 2_000, 3_000, 5_000, 5_000, 10_000, 10_000, 15_000,
];
// Keeps each page of the existing-orders query well under Shopify's query cost limit.
const ORDERS_PAGE_SIZE = 25;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const KEY_TAG_PREFIX = `${SEED_TAG}-key:`;
const PLAN_TAG_PREFIX = `${SEED_TAG}-plan:`;
const seedQuery = `tag:${SEED_TAG}`;
const planTag = (plan) => `${PLAN_TAG_PREFIX}${plan.size}-${plan.seed}`;
const tagValue = (tags, prefix) => tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);

const SHOP_QUERY = `query SeedShop { shop { name currencyCode myshopifyDomain } }`;

const EXISTING_PRODUCTS = `query SeedExistingProducts($query: String!) {
  products(first: 100, query: $query) {
    nodes { id title variants(first: 1) { nodes { id price } } }
  }
}`;

const CREATE_PRODUCT = `mutation SeedCreateProduct($input: ProductSetInput!) {
  productSet(synchronous: true, input: $input) {
    product { id title variants(first: 1) { nodes { id price } } }
    userErrors { field message }
  }
}`;

const EXISTING_CUSTOMERS = `query SeedExistingCustomers($query: String!) {
  customers(first: 100, query: $query) { nodes { id email } }
}`;

const FIND_CUSTOMER = `query SeedFindCustomer($query: String!) {
  customers(first: 1, query: $query) { nodes { id } }
}`;

const CREATE_CUSTOMER = `mutation SeedCreateCustomer($input: CustomerInput!) {
  customerCreate(input: $input) {
    customer { id }
    userErrors { field message }
  }
}`;

const ORDER_FIELDS = `
  id
  name
  tags
  cancelledAt
  transactions(first: 5) { id kind gateway amountSet { shopMoney { amount } } }
  lineItems(first: 10) { nodes { id quantity } }
  refunds(first: 5) { id }`;

const EXISTING_ORDERS = `query SeedExistingOrders($query: String!, $first: Int!, $cursor: String) {
  orders(first: $first, after: $cursor, query: $query) {
    nodes { ${ORDER_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CREATE_ORDER = `mutation SeedCreateOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order { ${ORDER_FIELDS} }
    userErrors { field message }
  }
}`;

// Refunds require an idempotency key since API version 2026-04.
const REFUND_ORDER = `mutation SeedRefundOrder($input: RefundInput!, $key: String!) {
  refundCreate(input: $input) @idempotent(key: $key) {
    refund { id }
    userErrors { field message }
  }
}`;

const CANCEL_ORDER = `mutation SeedCancelOrder($orderId: ID!) {
  orderCancel(
    orderId: $orderId
    reason: CUSTOMER
    restock: false
    notifyCustomer: false
    staffNote: "Seed data: cancelled by customer"
  ) {
    jobResult { id done status }
    orderCancelUserErrors { field message code }
  }
}`;

const CANCEL_JOB_STATUS = `query SeedCancelJobStatus($id: ID!) {
  node(id: $id) {
    ... on OrderCancelJobResult {
      done
      status
      errors { field message code }
    }
  }
}`;

const ORDER_CANCELLED_AT = `query SeedOrderCancelledAt($id: ID!) {
  order(id: $id) { id cancelledAt }
}`;

const COUNTS = `query SeedCounts($query: String!) {
  productsCount(query: $query) { count }
  customersCount(query: $query) { count }
  ordersCount(query: $query) { count }
}`;

// Deterministic UUID-shaped key, so retrying the same refund can never refund twice.
const idempotencyKey = (...parts) => {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const money = (value) => (Math.round(value * 100) / 100).toFixed(2);

// Runs a create that Shopify can't deduplicate. If the reply is lost, the record may or may not
// exist, so look for it (search can lag a few seconds) before trying once more.
const createSafely = async ({ create, find, label, log, sleep }) => {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await create();
    } catch (err) {
      if (!err.outcomeUnknown || attempt === 2) throw err;
      log(`  … no reply from Shopify for ${label}; checking whether it was created`);
      for (const delay of LOOKUP_DELAYS_MS) {
        await sleep(delay);
        const found = await find();
        if (found) {
          log(`  … ${label} had been created, reusing it`);
          return found;
        }
      }
      log(`  … ${label} wasn't created, trying again`);
    }
  }
  throw new ShopifyError(`Could not create ${label}`);
};

const seedProducts = async ({ client, plan, log, sleep }) => {
  const fetchSeeded = async () => {
    const { products } = await client.graphql(EXISTING_PRODUCTS, { query: seedQuery });
    return products.nodes;
  };

  const byTitle = new Map();
  for (const product of await fetchSeeded()) {
    if (byTitle.has(product.title))
      log(`  ! duplicate seeded product "${product.title}"; using the first`);
    else byTitle.set(product.title, product);
  }

  const result = [];
  let created = 0;

  for (const item of plan.products) {
    let product = byTitle.get(item.title);
    if (!product) {
      product = await createSafely({
        label: `product "${item.title}"`,
        log,
        sleep,
        find: async () => (await fetchSeeded()).find((p) => p.title === item.title),
        create: async () => {
          const data = await client.graphql(
            CREATE_PRODUCT,
            {
              input: {
                title: item.title,
                vendor: item.vendor,
                productType: item.productType,
                status: 'ACTIVE',
                tags: [SEED_TAG],
                productOptions: [
                  { name: 'Title', position: 1, values: [{ name: 'Default Title' }] },
                ],
                variants: [
                  {
                    optionValues: [{ optionName: 'Title', name: 'Default Title' }],
                    price: item.price,
                  },
                ],
              },
            },
            { idempotent: false },
          );
          return assertNoUserErrors(data.productSet, `Creating product "${item.title}"`).product;
        },
      });
      created += 1;
      log(`  + product ${item.title}`);
    }
    const variant = product.variants.nodes[0];
    result.push({ id: product.id, variantId: variant.id, price: Number(variant.price) });
  }

  return { items: result, created, existing: plan.products.length - created };
};

const seedCustomers = async ({ client, plan, log, sleep }) => {
  const { customers } = await client.graphql(EXISTING_CUSTOMERS, { query: seedQuery });
  // Emails can be null here if the app lacks protected customer data access; then a create
  // fails with "taken" and the customer is looked up by email instead.
  const byEmail = new Map(
    customers.nodes.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c.id]),
  );
  const findByEmail = async (email) => {
    const found = await client.graphql(FIND_CUSTOMER, { query: `email:"${email}"` });
    return found.customers.nodes[0]?.id;
  };

  const ids = [];
  let created = 0;

  for (const item of plan.customers) {
    let id = byEmail.get(item.email);
    if (!id) {
      const result = await createSafely({
        label: `customer ${item.email}`,
        log,
        sleep,
        find: async () => {
          const found = await findByEmail(item.email);
          return found && { id: found, existed: true };
        },
        create: async () => {
          const data = await client.graphql(
            CREATE_CUSTOMER,
            {
              input: {
                firstName: item.firstName,
                lastName: item.lastName,
                email: item.email,
                tags: [SEED_TAG],
              },
            },
            { idempotent: false },
          );
          const errors = data.customerCreate.userErrors;
          if (errors.length > 0 && errors.every((e) => /taken/i.test(e.message))) {
            const found = await findByEmail(item.email);
            if (!found)
              throw new ShopifyError(`Customer ${item.email} exists but could not be found`);
            return { id: found, existed: true };
          }
          return {
            id: assertNoUserErrors(data.customerCreate, `Creating customer ${item.email}`).customer
              .id,
            existed: false,
          };
        },
      });
      id = result.id;
      if (!result.existed) {
        created += 1;
        log(`  + customer ${item.firstName} ${item.lastName}`);
      }
    }
    ids.push(id);
  }

  return { ids, created, existing: plan.customers.length - created };
};

// All seeded orders, grouped by their plan key ("order-001" → [order, ...]).
const fetchSeededOrders = async (client) => {
  const byKey = new Map();
  let cursor = null;
  do {
    const { orders } = await client.graphql(EXISTING_ORDERS, {
      query: seedQuery,
      first: ORDERS_PAGE_SIZE,
      cursor,
    });
    for (const order of orders.nodes) {
      const key = tagValue(order.tags, KEY_TAG_PREFIX);
      if (key) byKey.set(key, [...(byKey.get(key) || []), order]);
    }
    cursor = orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null;
  } while (cursor);
  return byKey;
};

// Refuses to mix two different plans (sizes/seeds) in one store: the order keys would clash.
// Orders seeded before plan tags existed have none and are treated as matching.
const assertSamePlan = (byKey, plan) => {
  const current = planTag(plan).slice(PLAN_TAG_PREFIX.length);
  for (const orders of byKey.values()) {
    for (const order of orders) {
      const other = tagValue(order.tags, PLAN_TAG_PREFIX);
      if (other && other !== current) {
        throw new ShopifyError(
          `This store was seeded with plan "${other}", not "${current}". Re-run with the same ` +
            `--size (and --seed) as before; plans are never mixed in one store.`,
        );
      }
    }
  }
};

const createOrder = async ({ client, variables, sleep, log, label, key }) =>
  createSafely({
    label,
    log,
    sleep,
    find: async () => (await fetchSeededOrders(client)).get(key)?.[0],
    create: async () => {
      for (let attempt = 1; ; attempt += 1) {
        const data = await client.graphql(CREATE_ORDER, variables, { idempotent: false });
        const errors = data.orderCreate.userErrors;
        const rateLimited = errors.some((e) => /limit|too many|throttl/i.test(e.message));
        if (rateLimited && attempt < MAX_ORDER_ATTEMPTS) {
          log(`  … Shopify's order limit was hit, waiting a minute before retrying ${label}`);
          await sleep(ORDER_LIMIT_RETRY_MS);
          continue;
        }
        return assertNoUserErrors(data.orderCreate, `Creating ${label}`).order;
      }
    },
  });

const isRefunded = (order) => order.refunds.length > 0;
const isCancelled = (order) => Boolean(order.cancelledAt);

const refundOrder = async ({ client, order, domain, key }) => {
  const sale = order.transactions.find((t) => t.kind === 'SALE');
  if (!sale) throw new ShopifyError(`Order ${order.name} has no sale transaction to refund`);

  // Idempotent: the same key always refers to this one refund, so retries are safe.
  const data = await client.graphql(REFUND_ORDER, {
    key: idempotencyKey(domain, key, 'refund'),
    input: {
      orderId: order.id,
      note: 'Seed data: refunded to customer',
      refundLineItems: order.lineItems.nodes.map((item) => ({
        lineItemId: item.id,
        quantity: item.quantity,
        restockType: 'NO_RESTOCK',
      })),
      transactions: [
        {
          orderId: order.id,
          parentId: sale.id,
          kind: 'REFUND',
          gateway: sale.gateway,
          amount: sale.amountSet.shopMoney.amount,
        },
      ],
    },
  });
  assertNoUserErrors(data.refundCreate, `Refunding ${order.name}`);
};

const fetchCancelledAt = async (client, orderId) =>
  (await client.graphql(ORDER_CANCELLED_AT, { id: orderId })).order?.cancelledAt ?? null;

// Starts the cancellation and waits for Shopify's job to finish. Only returns once the order
// is confirmed cancelled; otherwise throws (a re-run picks it up again).
const cancelOrder = async ({ client, order, sleep }) => {
  if (await fetchCancelledAt(client, order.id)) return;

  let jobResult = null;
  try {
    const data = await client.graphql(CANCEL_ORDER, { orderId: order.id }, { idempotent: false });
    jobResult = assertNoUserErrors(data.orderCancel, `Cancelling ${order.name}`).jobResult;
  } catch (err) {
    // A lost reply (or "already cancelled") is settled by the order's own status below.
    if (!err.outcomeUnknown && !(await fetchCancelledAt(client, order.id))) throw err;
  }

  for (const delay of CANCEL_POLL_DELAYS_MS) {
    if (jobResult?.id && !jobResult.done) {
      const { node } = await client.graphql(CANCEL_JOB_STATUS, { id: jobResult.id });
      jobResult = { ...jobResult, ...node };
    }
    if (jobResult?.status === 'FAILED' || jobResult?.errors?.length) {
      const reason = (jobResult.errors || []).map((e) => e.message).join('; ') || 'job failed';
      throw new ShopifyError(`Cancelling ${order.name} failed: ${reason}`);
    }
    // Once the job is done (or there's no job to poll), the order itself is the proof.
    const jobFinished = !jobResult?.id || jobResult.done;
    if (jobFinished && (await fetchCancelledAt(client, order.id))) return;
    await sleep(delay);
  }

  throw new ShopifyError(
    `Cancellation of ${order.name} hasn't finished yet. Re-run the seeder to finish it.`,
  );
};

// Brings an order to its planned outcome (refunded / cancelled). Safe to call repeatedly.
const applyOutcome = async ({ client, order, planned, domain, sleep }) => {
  if (planned.outcome === 'refunded' && !isRefunded(order)) {
    await refundOrder({ client, order, domain, key: planned.key });
    return 'refunded';
  }
  if (planned.outcome === 'cancelled' && !isCancelled(order)) {
    await cancelOrder({ client, order, sleep });
    return 'cancelled';
  }
  return null;
};

const seedOrders = async ({
  client,
  plan,
  products,
  customerIds,
  currencyCode,
  domain,
  log,
  sleep,
  orderIntervalMs,
}) => {
  const byKey = await fetchSeededOrders(client);
  assertSamePlan(byKey, plan);

  const stats = {
    created: 0,
    existing: 0,
    repaired: 0,
    cancelled: 0,
    refunded: 0,
    guest: 0,
    duplicates: 0,
  };

  // Existing orders: never recreated or changed, except finishing a refund/cancel that an
  // interrupted run didn't get to.
  for (const planned of plan.orders) {
    const orders = byKey.get(planned.key);
    if (!orders) continue;
    stats.existing += 1;
    if (orders.length > 1) {
      stats.duplicates += orders.length - 1;
      log(
        `  ! ${orders.length} orders share key ${planned.key} (${orders.map((o) => o.name).join(', ')}); not changing them`,
      );
    }
    const done = await applyOutcome({ client, order: orders[0], planned, domain, sleep });
    if (done) {
      stats.repaired += 1;
      stats[done] += 1;
      log(`  ~ ${orders[0].name} finished: ${done}`);
    }
  }

  const todo = plan.orders.filter((o) => !byKey.has(o.key));
  if (todo.length > 0) {
    const minutes = Math.ceil((todo.length * orderIntervalMs) / 60000);
    log(
      `  ${todo.length} orders to create (about ${minutes} min: dev stores allow 5 orders/minute)`,
    );
  }

  let lastCreatedAt = 0;
  for (const planned of todo) {
    const wait = lastCreatedAt + orderIntervalMs - Date.now();
    if (lastCreatedAt && wait > 0) await sleep(wait);

    const lines = planned.lines.map((line) => ({ ...line, product: products[line.productIndex] }));
    const total = money(lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0));
    const paid = planned.outcome !== 'cancelled';
    const guest = planned.customerIndex === null;

    const order = await createOrder({
      client,
      sleep,
      log,
      key: planned.key,
      label: `order ${planned.key}`,
      variables: {
        options: { sendReceipt: false, sendFulfillmentReceipt: false },
        order: {
          processedAt: planned.processedAt,
          lineItems: lines.map((line) => ({
            variantId: line.product.variantId,
            quantity: line.quantity,
          })),
          ...(guest
            ? { email: planned.guestEmail }
            : { customer: { toAssociate: { id: customerIds[planned.customerIndex] } } }),
          financialStatus: paid ? 'PAID' : 'PENDING',
          ...(paid && {
            transactions: [
              {
                kind: 'SALE',
                status: 'SUCCESS',
                gateway: 'manual',
                processedAt: planned.processedAt,
                amountSet: { shopMoney: { amount: total, currencyCode } },
              },
            ],
          }),
          tags: [SEED_TAG, `${KEY_TAG_PREFIX}${planned.key}`, planTag(plan)],
          note: `Seed data (${planned.outcome}${guest ? ', guest checkout' : ''})`,
        },
      },
    });
    lastCreatedAt = Date.now();
    stats.created += 1;
    if (guest) stats.guest += 1;

    const done = await applyOutcome({ client, order, planned, domain, sleep });
    if (done) stats[done] += 1;

    log(
      `  + ${order.name} ${planned.processedAt.slice(0, 10)} ₹${total} ${planned.outcome}${guest ? ' (guest)' : ''}` +
        `  [${stats.created}/${todo.length}]`,
    );
  }

  return stats;
};

const countSeeded = async (client) => {
  try {
    const data = await client.graphql(COUNTS, { query: seedQuery });
    return {
      products: data.productsCount.count,
      customers: data.customersCount.count,
      orders: data.ordersCount.count,
    };
  } catch (err) {
    return { error: err.message };
  }
};

const seedStore = async ({
  client,
  plan,
  log = console.log,
  sleep = realSleep,
  orderIntervalMs = ORDER_INTERVAL_MS,
  requiredCurrency = 'INR',
}) => {
  const { shop } = await client.graphql(SHOP_QUERY);
  log(`Store: ${shop.name} (${shop.myshopifyDomain}), currency ${shop.currencyCode}`);

  if (requiredCurrency && shop.currencyCode !== requiredCurrency) {
    throw new ShopifyError(
      `Store currency is ${shop.currencyCode} but the platform is ${requiredCurrency}-only. ` +
        `Change it in Shopify admin → Settings → General → Store defaults → Currency, then re-run ` +
        `(or pass --any-currency to seed anyway).`,
    );
  }

  log(`Products (${plan.products.length})…`);
  const products = await seedProducts({ client, plan, log, sleep });
  log(`Customers (${plan.customers.length})…`);
  const customers = await seedCustomers({ client, plan, log, sleep });
  log(`Orders (${plan.orders.length})…`);
  const orders = await seedOrders({
    client,
    plan,
    products: products.items,
    customerIds: customers.ids,
    currencyCode: shop.currencyCode,
    domain: shop.myshopifyDomain,
    log,
    sleep,
    orderIntervalMs,
  });

  return {
    shop,
    products: { created: products.created, existing: products.existing },
    customers: { created: customers.created, existing: customers.existing },
    orders,
    totals: await countSeeded(client),
  };
};

module.exports = { seedStore, idempotencyKey, ORDER_INTERVAL_MS };
