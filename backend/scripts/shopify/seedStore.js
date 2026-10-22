// Creates the seed plan's products, customers and orders in a Shopify dev store.
// Safe to re-run: everything is tagged, existing records are reused, and an interrupted run
// continues where it stopped instead of creating duplicates.
const { createHash } = require('crypto');
const { assertNoUserErrors, ShopifyError } = require('./client');
const { SEED_TAG } = require('./seedPlan');

// Dev stores accept at most 5 new orders per minute (orderCreate docs), so space them out.
const ORDER_INTERVAL_MS = 12_500;
const ORDER_LIMIT_RETRY_MS = 60_000;
const MAX_ORDER_ATTEMPTS = 3;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const orderKeyTag = (key) => `${SEED_TAG}-key:${key}`;
const seedQuery = `tag:${SEED_TAG}`;

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

const EXISTING_ORDERS = `query SeedExistingOrders($query: String!, $cursor: String) {
  orders(first: 100, after: $cursor, query: $query) {
    nodes { id tags }
    pageInfo { hasNextPage endCursor }
  }
}`;

const CREATE_ORDER = `mutation SeedCreateOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    order {
      id
      name
      transactions(first: 5) { id kind gateway amountSet { shopMoney { amount } } }
      lineItems(first: 10) { nodes { id quantity } }
    }
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

// Cancellation runs asynchronously on Shopify's side; the job finishes on its own.
const CANCEL_ORDER = `mutation SeedCancelOrder($orderId: ID!) {
  orderCancel(
    orderId: $orderId
    reason: CUSTOMER
    restock: false
    notifyCustomer: false
    staffNote: "Seed data: cancelled by customer"
  ) {
    job { id done }
    orderCancelUserErrors { field message code }
  }
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

const seedProducts = async ({ client, plan, log }) => {
  const { products } = await client.graphql(EXISTING_PRODUCTS, { query: seedQuery });
  const byTitle = new Map(products.nodes.map((p) => [p.title, p]));
  const result = [];
  let created = 0;

  for (const item of plan.products) {
    let product = byTitle.get(item.title);
    if (!product) {
      const data = await client.graphql(CREATE_PRODUCT, {
        input: {
          title: item.title,
          vendor: item.vendor,
          productType: item.productType,
          status: 'ACTIVE',
          tags: [SEED_TAG],
          productOptions: [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
          variants: [
            { optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: item.price },
          ],
        },
      });
      product = assertNoUserErrors(data.productSet, `Creating product "${item.title}"`).product;
      created += 1;
      log(`  + product ${item.title}`);
    }
    const variant = product.variants.nodes[0];
    result.push({ id: product.id, variantId: variant.id, price: Number(variant.price) });
  }

  return { items: result, created, existing: plan.products.length - created };
};

const seedCustomers = async ({ client, plan, log }) => {
  const { customers } = await client.graphql(EXISTING_CUSTOMERS, { query: seedQuery });
  // Emails can be null here if the app lacks protected customer data access; then a create
  // fails with "taken" and the customer is looked up by email instead.
  const byEmail = new Map(
    customers.nodes.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c.id]),
  );
  const ids = [];
  let created = 0;

  for (const item of plan.customers) {
    let id = byEmail.get(item.email);
    if (!id) {
      const data = await client.graphql(CREATE_CUSTOMER, {
        input: {
          firstName: item.firstName,
          lastName: item.lastName,
          email: item.email,
          tags: [SEED_TAG],
        },
      });
      const errors = data.customerCreate.userErrors;
      if (errors.length > 0 && errors.every((e) => /taken/i.test(e.message))) {
        const found = await client.graphql(FIND_CUSTOMER, { query: `email:"${item.email}"` });
        id = found.customers.nodes[0]?.id;
        if (!id) throw new ShopifyError(`Customer ${item.email} exists but could not be found`);
      } else {
        id = assertNoUserErrors(data.customerCreate, `Creating customer ${item.email}`).customer.id;
        created += 1;
        log(`  + customer ${item.firstName} ${item.lastName}`);
      }
    }
    ids.push(id);
  }

  return { ids, created, existing: plan.customers.length - created };
};

const existingOrderKeys = async (client) => {
  const keys = new Set();
  let cursor = null;
  do {
    const { orders } = await client.graphql(EXISTING_ORDERS, { query: seedQuery, cursor });
    for (const order of orders.nodes) {
      for (const tag of order.tags) {
        if (tag.startsWith(orderKeyTag(''))) keys.add(tag.slice(orderKeyTag('').length));
      }
    }
    cursor = orders.pageInfo.hasNextPage ? orders.pageInfo.endCursor : null;
  } while (cursor);
  return keys;
};

const createOrderWithRetry = async ({ client, variables, sleep, log, label }) => {
  for (let attempt = 1; ; attempt += 1) {
    const data = await client.graphql(CREATE_ORDER, variables);
    const errors = data.orderCreate.userErrors;
    const rateLimited = errors.some((e) => /limit|too many|throttl/i.test(e.message));
    if (rateLimited && attempt < MAX_ORDER_ATTEMPTS) {
      log(`  … Shopify's order limit was hit, waiting a minute before retrying ${label}`);
      await sleep(ORDER_LIMIT_RETRY_MS);
      continue;
    }
    return assertNoUserErrors(data.orderCreate, `Creating ${label}`).order;
  }
};

const refundOrder = async ({ client, order, domain, key }) => {
  const sale = order.transactions.find((t) => t.kind === 'SALE');
  if (!sale) throw new ShopifyError(`Order ${order.name} has no sale transaction to refund`);

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

const cancelOrder = async ({ client, order }) => {
  const data = await client.graphql(CANCEL_ORDER, { orderId: order.id });
  assertNoUserErrors(data.orderCancel, `Cancelling ${order.name}`);
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
  const existing = await existingOrderKeys(client);
  const todo = plan.orders.filter((o) => !existing.has(o.key));
  const stats = { created: 0, existing: existing.size, cancelled: 0, refunded: 0, guest: 0 };

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

    const order = await createOrderWithRetry({
      client,
      sleep,
      log,
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
          tags: [SEED_TAG, orderKeyTag(planned.key)],
          note: `Seed data (${planned.outcome}${guest ? ', guest checkout' : ''})`,
        },
      },
    });
    lastCreatedAt = Date.now();
    stats.created += 1;
    if (guest) stats.guest += 1;

    if (planned.outcome === 'refunded') {
      await refundOrder({ client, order, domain, key: planned.key });
      stats.refunded += 1;
    } else if (planned.outcome === 'cancelled') {
      await cancelOrder({ client, order });
      stats.cancelled += 1;
    }

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
  const products = await seedProducts({ client, plan, log });
  log(`Customers (${plan.customers.length})…`);
  const customers = await seedCustomers({ client, plan, log });
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
