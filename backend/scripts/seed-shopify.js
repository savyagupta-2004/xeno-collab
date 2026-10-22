#!/usr/bin/env node
// Fills a Shopify development store with realistic demo data (XENO-8).
//
//   npm run seed:shopify -- --dry-run          show what would be created, no API calls
//   npm run seed:shopify                       main store: 24 products, 32 customers, 55 orders
//   npm run seed:shopify -- --size small       second store: 6 products, 6 customers, 12 orders
//
// Store and credentials come from backend/.env (see docs/shopify-setup.md). Safe to re-run.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { createShopifyClient, getAccessToken } = require('./shopify/client');
const { buildSeedPlan, describePlan } = require('./shopify/seedPlan');
const { seedStore } = require('./shopify/seedStore');

const parseArgs = (argv) => {
  const args = { size: 'full', seed: 42, dryRun: false, anyCurrency: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--any-currency') args.anyCurrency = true;
    else if (arg === '--size') args.size = argv[++i];
    else if (arg === '--seed') args.seed = Number(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildSeedPlan({ size: args.size, seed: args.seed });
  const overview = describePlan(plan);

  console.log(
    `Plan (${args.size}): ${overview.products} products, ${overview.customers} customers, ` +
      `${overview.orders} orders from ${overview.from} to ${overview.to} (${overview.spreadDays} days); ` +
      `${overview.cancelled} cancelled, ${overview.refunded} refunded, ${overview.guest} guest checkouts`,
  );
  if (args.dryRun) return;

  const { domain, accessToken, source } = await getAccessToken(process.env);
  console.log(`Using ${domain} (token from ${source})`);
  const client = createShopifyClient({
    domain,
    accessToken,
    apiVersion: process.env.SHOPIFY_API_VERSION || undefined,
  });

  const summary = await seedStore({
    client,
    plan,
    requiredCurrency: args.anyCurrency ? null : 'INR',
  });

  console.log('\nDone.');
  console.log(
    `  products : ${summary.products.created} created, ${summary.products.existing} already there`,
  );
  console.log(
    `  customers: ${summary.customers.created} created, ${summary.customers.existing} already there`,
  );
  console.log(
    `  orders   : ${summary.orders.created} created (${summary.orders.cancelled} cancelled, ` +
      `${summary.orders.refunded} refunded, ${summary.orders.guest} guest), ${summary.orders.existing} already there`,
  );
  if (summary.totals.error) {
    console.log(`  (could not read totals: ${summary.totals.error})`);
  } else {
    const { products, customers, orders } = summary.totals;
    console.log(
      `  seeded totals in the store: ${products} products, ${customers} customers, ${orders} orders`,
    );
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nSeeding failed: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs };
