// Builds the data the seeding script creates in a Shopify dev store.
// Deterministic: the same size + seed always gives the same products, customers and orders,
// so a re-run (or a teammate's run) produces the same store.

// Every record the seeder creates is tagged with this, so it can find (and skip) them later.
const SEED_TAG = 'xeno-seed';

const SIZES = {
  // Main dev store (story XENO-8: >= 20 products, 30 customers, 50 orders over >= 30 days)
  full: { products: 24, customers: 32, orders: 55, days: 45 },
  // Second dev store for multi-tenancy tests (>= 5 customers, 10 orders)
  small: { products: 6, customers: 6, orders: 12, days: 30 },
};

// Prices in INR (the platform is INR-only).
const PRODUCTS = [
  { title: 'Classic Cotton Kurta', productType: 'Apparel', price: '1299.00' },
  { title: 'Handloom Silk Saree', productType: 'Apparel', price: '4899.00' },
  { title: 'Linen Nehru Jacket', productType: 'Apparel', price: '2499.00' },
  { title: 'Block Print Dupatta', productType: 'Accessories', price: '699.00' },
  { title: 'Leather Kolhapuri Chappals', productType: 'Footwear', price: '1599.00' },
  { title: 'Embroidered Juttis', productType: 'Footwear', price: '1199.00' },
  { title: 'Brass Diya Set', productType: 'Home', price: '549.00' },
  { title: 'Terracotta Planter', productType: 'Home', price: '399.00' },
  { title: 'Jaipuri Cotton Bedsheet', productType: 'Home', price: '1799.00' },
  { title: 'Hand-painted Coasters (Set of 4)', productType: 'Home', price: '349.00' },
  { title: 'Masala Chai Gift Box', productType: 'Food', price: '599.00' },
  { title: 'Darjeeling First Flush Tea', productType: 'Food', price: '749.00' },
  { title: 'Cold-pressed Coconut Oil', productType: 'Wellness', price: '299.00' },
  { title: 'Ayurvedic Face Pack', productType: 'Wellness', price: '449.00' },
  { title: 'Sandalwood Soap Trio', productType: 'Wellness', price: '329.00' },
  { title: 'Oxidised Silver Jhumkas', productType: 'Jewellery', price: '899.00' },
  { title: 'Kundan Choker Necklace', productType: 'Jewellery', price: '2199.00' },
  { title: 'Beaded Anklet Pair', productType: 'Jewellery', price: '499.00' },
  { title: 'Jute Tote Bag', productType: 'Accessories', price: '599.00' },
  { title: 'Ikat Laptop Sleeve', productType: 'Accessories', price: '999.00' },
  { title: 'Madhubani Wall Art', productType: 'Art', price: '3499.00' },
  { title: 'Wooden Chess Set', productType: 'Toys', price: '1899.00' },
  { title: 'Kids Cotton Pyjama Set', productType: 'Apparel', price: '799.00' },
  { title: 'Copper Water Bottle', productType: 'Home', price: '949.00' },
];

const FIRST_NAMES = [
  'Aarav',
  'Ananya',
  'Rohan',
  'Diya',
  'Vivaan',
  'Ishita',
  'Kabir',
  'Meera',
  'Arjun',
  'Saanvi',
  'Reyansh',
  'Kavya',
  'Aditya',
  'Priya',
  'Vihaan',
  'Nisha',
];
const LAST_NAMES = [
  'Sharma',
  'Iyer',
  'Patel',
  'Reddy',
  'Nair',
  'Gupta',
  'Banerjee',
  'Singh',
  'Khan',
  'Menon',
  'Joshi',
  'Das',
  'Kulkarni',
  'Fernandes',
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Small seeded PRNG (mulberry32) so plans are reproducible without extra dependencies.
const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, min, max) => min + Math.floor(random() * (max - min + 1));

// Edge cases spread through the order list (every ~10th cancelled/refunded, every ~7th guest).
const outcomeFor = (index) => {
  if (index % 10 === 3) return 'cancelled';
  if (index % 10 === 7) return 'refunded';
  return 'paid';
};
const isGuest = (index) => index % 7 === 2;

const buildSeedPlan = ({ size = 'full', seed = 42, now = new Date() } = {}) => {
  const config = SIZES[size];
  if (!config)
    throw new Error(`Unknown size "${size}". Use one of: ${Object.keys(SIZES).join(', ')}`);

  const random = createRandom(seed);

  const products = PRODUCTS.slice(0, config.products).map((product) => ({
    ...product,
    vendor: 'Xeno Demo',
  }));

  const customers = Array.from({ length: config.customers }, (_, i) => {
    const firstName = pick(random, FIRST_NAMES);
    const lastName = pick(random, LAST_NAMES);
    const number = String(i + 1).padStart(3, '0');
    // example.com is reserved for examples, so these can never reach a real inbox.
    return {
      firstName,
      lastName,
      email: `${firstName}.${lastName}.${number}@example.com`.toLowerCase(),
    };
  });

  // Oldest order exactly `days` ago, newest today, the rest spread evenly with random hours.
  const start = now.getTime() - config.days * DAY_MS;
  let guestNumber = 0;
  const orders = Array.from({ length: config.orders }, (_, i) => {
    const dayOffset = Math.round((i * config.days) / Math.max(config.orders - 1, 1));
    const hours = between(random, 9, 21) * 60 * 60 * 1000 + between(random, 0, 59) * 60 * 1000;
    const processedAt = new Date(
      Math.min(start + dayOffset * DAY_MS + hours, now.getTime() - 60 * 1000),
    );

    const lineCount = between(random, 1, 3);
    const productIndexes = new Set();
    while (productIndexes.size < Math.min(lineCount, products.length)) {
      productIndexes.add(Math.floor(random() * products.length));
    }

    const guest = isGuest(i);
    if (guest) guestNumber += 1;

    return {
      key: `order-${String(i + 1).padStart(3, '0')}`,
      processedAt: processedAt.toISOString(),
      outcome: outcomeFor(i),
      customerIndex: guest ? null : Math.floor(random() * customers.length),
      guestEmail: guest ? `guest.${String(guestNumber).padStart(3, '0')}@example.com` : null,
      lines: [...productIndexes].map((productIndex) => ({
        productIndex,
        quantity: between(random, 1, 3),
      })),
    };
  });

  return { size, seed, products, customers, orders };
};

// One-line overview of a plan, used by --dry-run and the final summary.
const describePlan = (plan) => {
  const dates = plan.orders.map((o) => Date.parse(o.processedAt));
  const count = (fn) => plan.orders.filter(fn).length;
  return {
    products: plan.products.length,
    customers: plan.customers.length,
    orders: plan.orders.length,
    from: new Date(Math.min(...dates)).toISOString().slice(0, 10),
    to: new Date(Math.max(...dates)).toISOString().slice(0, 10),
    spreadDays: Math.round((Math.max(...dates) - Math.min(...dates)) / DAY_MS),
    cancelled: count((o) => o.outcome === 'cancelled'),
    refunded: count((o) => o.outcome === 'refunded'),
    guest: count((o) => o.customerIndex === null),
  };
};

module.exports = { SEED_TAG, SIZES, buildSeedPlan, describePlan };
