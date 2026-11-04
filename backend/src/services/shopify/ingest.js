// Copies a store's customers, products and orders into PostgreSQL. Every write is an upsert on
// (tenant, Shopify id), so running a sync again updates rows instead of duplicating them.
//
// Shopify ids are stored as the number at the end of the gid ("gid://shopify/Order/123" -> "123"),
// which is also what webhooks send.

const PAGE_SIZE = 50;
// Each order also fetches line items, so smaller pages keep the query under Shopify's cost limit.
const ORDERS_PAGE_SIZE = 25;
const LINE_ITEMS_PER_ORDER = 20;

const CUSTOMERS_QUERY = `query SyncCustomers($first: Int!, $after: String) {
  customers(first: $first, after: $after) {
    nodes {
      id
      firstName
      lastName
      defaultEmailAddress { emailAddress }
      defaultPhoneNumber { phoneNumber }
      numberOfOrders
      amountSpent { amount }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const PRODUCTS_QUERY = `query SyncProducts($first: Int!, $after: String) {
  products(first: $first, after: $after) {
    nodes {
      id
      title
      vendor
      productType
      status
      priceRangeV2 { minVariantPrice { amount } }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const LINE_ITEM_FIELDS = `
  id
  title
  variantTitle
  sku
  quantity
  originalUnitPriceSet { shopMoney { amount } }
  product { id }`;

const ORDERS_QUERY = `query SyncOrders($first: Int!, $after: String) {
  orders(first: $first, after: $after) {
    nodes {
      id
      name
      email
      customer { id }
      subtotalPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      displayFinancialStatus
      displayFulfillmentStatus
      cancelledAt
      processedAt
      updatedAt
      lineItems(first: ${LINE_ITEMS_PER_ORDER}) {
        nodes { ${LINE_ITEM_FIELDS} }
        pageInfo { hasNextPage }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ORDER_LINE_ITEMS_QUERY = `query SyncOrderLineItems($id: ID!, $first: Int!, $after: String) {
  order(id: $id) {
    lineItems(first: $first, after: $after) {
      nodes { ${LINE_ITEM_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const shopifyId = (gid) => gid.split('/').pop();
const shopMoney = (set) => set?.shopMoney?.amount ?? '0';
const lowerCase = (value) => value?.toLowerCase() ?? null;

const syncCustomers = async ({ tenantId, db, shopify }) => {
  let synced = 0;
  for await (const nodes of shopify.paginate(CUSTOMERS_QUERY, {
    connection: 'customers',
    pageSize: PAGE_SIZE,
  })) {
    for (const node of nodes) {
      const shopifyCustomerId = shopifyId(node.id);
      const fields = {
        email: node.defaultEmailAddress?.emailAddress ?? null,
        firstName: node.firstName,
        lastName: node.lastName,
        phone: node.defaultPhoneNumber?.phoneNumber ?? null,
        ordersCount: Number(node.numberOfOrders),
        totalSpent: node.amountSpent.amount,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
      await db.customer.upsert({
        where: { tenantId_shopifyCustomerId: { tenantId, shopifyCustomerId } },
        create: { shopifyCustomerId, ...fields },
        update: fields,
        select: { id: true },
      });
      synced += 1;
    }
  }
  return synced;
};

const syncProducts = async ({ tenantId, db, shopify }) => {
  let synced = 0;
  for await (const nodes of shopify.paginate(PRODUCTS_QUERY, {
    connection: 'products',
    pageSize: PAGE_SIZE,
  })) {
    for (const node of nodes) {
      const shopifyProductId = shopifyId(node.id);
      const fields = {
        title: node.title,
        vendor: node.vendor || null,
        productType: node.productType || null,
        status: lowerCase(node.status),
        price: node.priceRangeV2.minVariantPrice.amount,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
      await db.product.upsert({
        where: { tenantId_shopifyProductId: { tenantId, shopifyProductId } },
        create: { shopifyProductId, ...fields },
        update: fields,
        select: { id: true },
      });
      synced += 1;
    }
  }
  return synced;
};

const orderLineItems = async (shopify, node) => {
  if (!node.lineItems.pageInfo.hasNextPage) return node.lineItems.nodes;
  return shopify.fetchAll(ORDER_LINE_ITEMS_QUERY, {
    connection: 'order.lineItems',
    pageSize: PAGE_SIZE,
    variables: { id: node.id },
  });
};

const saveOrder = ({ tenantId, db, node, lineItems, customerIds, productIds }) =>
  // An order and its line items are saved together, so a failure can't leave half an order.
  db.$transaction(async (tx) => {
    const shopifyOrderId = shopifyId(node.id);
    const fields = {
      orderNumber: node.name,
      customerId: node.customer ? (customerIds.get(shopifyId(node.customer.id)) ?? null) : null,
      email: node.email,
      subtotalPrice: shopMoney(node.subtotalPriceSet),
      totalDiscounts: shopMoney(node.totalDiscountsSet),
      totalTax: shopMoney(node.totalTaxSet),
      totalPrice: shopMoney(node.totalPriceSet),
      financialStatus: lowerCase(node.displayFinancialStatus),
      fulfillmentStatus: lowerCase(node.displayFulfillmentStatus),
      cancelledAt: node.cancelledAt,
      // processedAt is the date the order was placed; Shopify's createdAt is when the record was
      // made, which differs for imported or back-dated orders and would skew orders-by-date.
      createdAt: node.processedAt,
      updatedAt: node.updatedAt,
    };
    const order = await tx.order.upsert({
      where: { tenantId_shopifyOrderId: { tenantId, shopifyOrderId } },
      create: { shopifyOrderId, ...fields },
      update: fields,
      select: { id: true },
    });

    for (const item of lineItems) {
      const shopifyLineItemId = shopifyId(item.id);
      const shopifyProductId = item.product ? shopifyId(item.product.id) : null;
      const itemFields = {
        orderId: order.id,
        productId: productIds.get(shopifyProductId) ?? null,
        shopifyProductId,
        title: item.title,
        variantTitle: item.variantTitle,
        sku: item.sku,
        quantity: item.quantity,
        price: shopMoney(item.originalUnitPriceSet),
      };
      await tx.orderLineItem.upsert({
        where: { tenantId_shopifyLineItemId: { tenantId, shopifyLineItemId } },
        create: { shopifyLineItemId, ...itemFields },
        update: itemFields,
        select: { id: true },
      });
    }
  });

// Runs after customers and products, so orders can link to them.
const syncOrders = async ({ tenantId, db, shopify }) => {
  const customers = await db.customer.findMany({ select: { id: true, shopifyCustomerId: true } });
  const products = await db.product.findMany({ select: { id: true, shopifyProductId: true } });
  const customerIds = new Map(customers.map((c) => [c.shopifyCustomerId, c.id]));
  const productIds = new Map(products.map((p) => [p.shopifyProductId, p.id]));

  let synced = 0;
  for await (const nodes of shopify.paginate(ORDERS_QUERY, {
    connection: 'orders',
    pageSize: ORDERS_PAGE_SIZE,
  })) {
    for (const node of nodes) {
      const lineItems = await orderLineItems(shopify, node);
      await saveOrder({ tenantId, db, node, lineItems, customerIds, productIds });
      synced += 1;
    }
  }
  return synced;
};

module.exports = { syncCustomers, syncProducts, syncOrders };
