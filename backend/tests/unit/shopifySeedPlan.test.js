const { buildSeedPlan, describePlan, SIZES } = require('../../scripts/shopify/seedPlan');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-22T12:00:00Z');

describe('seed plan for the main dev store', () => {
  const plan = buildSeedPlan({ size: 'full', now });
  const overview = describePlan(plan);

  it('has at least 20 products, 30 customers and 50 orders (XENO-8 AC2)', () => {
    expect(overview.products).toBeGreaterThanOrEqual(20);
    expect(overview.customers).toBeGreaterThanOrEqual(30);
    expect(overview.orders).toBeGreaterThanOrEqual(50);
  });

  it('spreads order dates over at least 30 days, all in the past', () => {
    const dates = plan.orders.map((o) => Date.parse(o.processedAt));
    expect((Math.max(...dates) - Math.min(...dates)) / DAY_MS).toBeGreaterThanOrEqual(30);
    expect(Math.max(...dates)).toBeLessThan(now.getTime());
  });

  it('includes cancelled, refunded and guest-checkout orders (XENO-8 AC3)', () => {
    expect(overview.cancelled).toBeGreaterThan(0);
    expect(overview.refunded).toBeGreaterThan(0);
    expect(overview.guest).toBeGreaterThan(0);
  });

  it('only references products and customers that exist in the plan', () => {
    for (const order of plan.orders) {
      expect(order.lines.length).toBeGreaterThan(0);
      for (const line of order.lines) {
        expect(plan.products[line.productIndex]).toBeDefined();
        expect(line.quantity).toBeGreaterThanOrEqual(1);
      }
      if (order.customerIndex === null) expect(order.guestEmail).toMatch(/@example\.com$/);
      else expect(plan.customers[order.customerIndex]).toBeDefined();
    }
  });

  it('uses unique, non-deliverable example.com emails and INR prices', () => {
    const emails = plan.customers.map((c) => c.email);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.every((e) => e.endsWith('@example.com'))).toBe(true);
    expect(plan.products.every((p) => /^\d+\.\d{2}$/.test(p.price))).toBe(true);
  });

  it('is deterministic, so every run creates the same store', () => {
    expect(buildSeedPlan({ size: 'full', now })).toEqual(plan);
    expect(buildSeedPlan({ size: 'full', now, seed: 7 })).not.toEqual(plan);
  });
});

describe('seed plan for the second (multi-tenancy) store', () => {
  const overview = describePlan(buildSeedPlan({ size: 'small', now }));

  it('has at least 5 customers and 10 orders (XENO-8 AC5) and still covers the edge cases', () => {
    expect(overview.customers).toBeGreaterThanOrEqual(5);
    expect(overview.orders).toBeGreaterThanOrEqual(10);
    expect(overview.cancelled).toBeGreaterThan(0);
    expect(overview.refunded).toBeGreaterThan(0);
    expect(overview.guest).toBeGreaterThan(0);
  });
});

it('rejects unknown sizes', () => {
  expect(() => buildSeedPlan({ size: 'huge' })).toThrow(Object.keys(SIZES).join(', '));
});
