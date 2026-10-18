jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const {
  forTenant,
  scopeArgs,
  verifyResult,
  TENANT_SCOPED_MODELS,
} = require('../../src/services/tenantDb');

const A = 'tenant-a';
const B = 'tenant-b';
const scope = (model, operation, args) => scopeArgs({ model, operation, args }, A);

describe('scopeArgs', () => {
  it.each([
    'findUnique',
    'findFirst',
    'findMany',
    'count',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
  ])('%s keeps the caller filter and adds tenantId with AND', (operation) => {
    const scoped = scope('Customer', operation, { where: { id: 5 } });

    expect(scoped.where).toEqual({ id: 5, AND: [{ tenantId: A }] });
  });

  it('adds the filter when the caller passed no where at all', () => {
    expect(scope('Order', 'findMany', undefined).where).toEqual({ AND: [{ tenantId: A }] });
  });

  it('keeps an existing AND (object or array) instead of replacing it', () => {
    expect(scope('Order', 'findMany', { where: { AND: { email: 'x' } } }).where).toEqual({
      AND: [{ email: 'x' }, { tenantId: A }],
    });
    expect(scope('Order', 'findMany', { where: { AND: [{ a: 1 }, { b: 2 }] } }).where.AND).toEqual([
      { a: 1 },
      { b: 2 },
      { tenantId: A },
    ]);
  });

  it("can't be widened: asking for another tenant's rows still requires this tenant", () => {
    const scoped = scope('Customer', 'findMany', { where: { tenantId: B } });

    expect(scoped.where).toEqual({ tenantId: B, AND: [{ tenantId: A }] });
  });

  it('stamps tenantId on create and createMany', () => {
    expect(scope('Product', 'create', { data: { title: 'Tee' } }).data).toEqual({
      title: 'Tee',
      tenantId: A,
    });
    expect(scope('Product', 'createMany', { data: [{ title: 'a' }, { title: 'b' }] }).data).toEqual(
      [
        { title: 'a', tenantId: A },
        { title: 'b', tenantId: A },
      ],
    );
  });

  it('scopes upsert: where gets the filter, create gets tenantId', () => {
    const scoped = scope('Customer', 'upsert', {
      where: { id: 1 },
      create: { email: 'x' },
      update: { email: 'y' },
    });

    expect(scoped.where).toEqual({ id: 1, AND: [{ tenantId: A }] });
    expect(scoped.create).toEqual({ email: 'x', tenantId: A });
    expect(scoped.update).toEqual({ email: 'y' });
  });

  it.each([
    ['create', { data: { tenantId: B } }],
    ['createMany', { data: [{ tenantId: A }, { tenantId: B }] }],
    ['update', { where: { id: 1 }, data: { tenantId: B } }],
    ['updateMany', { data: { tenantId: B } }],
    ['upsert', { where: { id: 1 }, create: { tenantId: B }, update: {} }],
    ['upsert', { where: { id: 1 }, create: {}, update: { tenantId: B } }],
  ])('refuses %s that would write into another tenant', (operation, args) => {
    expect(() => scope('Order', operation, args)).toThrow('another tenant');
  });

  it('limits the Tenant model to the caller’s own row', () => {
    expect(scope('Tenant', 'findUnique', { where: { id: B } }).where).toEqual({
      id: B,
      AND: [{ id: A }],
    });
  });

  it.each(['create', 'delete', 'deleteMany', 'upsert'])('blocks Tenant.%s', (operation) => {
    expect(() => scope('Tenant', operation, {})).toThrow('not allowed');
  });

  it('rejects a model without tenantId, so a new table cannot be left unscoped', () => {
    expect(() => scope('Webhook', 'findMany', {})).toThrow('has no tenantId');
  });
});

describe('tenant-owned models come from the Prisma schema', () => {
  const { Prisma } = require('@prisma/client');
  const schemaModels = Prisma.dmmf.datamodel.models.map((m) => m.name);

  it('every model except Tenant has a direct tenantId and is scoped', () => {
    expect([...TENANT_SCOPED_MODELS].sort()).toEqual(
      schemaModels.filter((name) => name !== 'Tenant').sort(),
    );
  });

  it('includes the line items and events tables under their schema names', () => {
    expect(TENANT_SCOPED_MODELS.has('OrderLineItem')).toBe(true);
    expect(TENANT_SCOPED_MODELS.has('Event')).toBe(true);
  });
});

describe('nested relation reads', () => {
  it('adds the tenant filter to list relations in include', () => {
    const scoped = scope('Order', 'findUnique', {
      where: { id: 1 },
      include: { lineItems: { orderBy: { id: 'asc' } } },
    });

    expect(scoped.include.lineItems).toEqual({
      orderBy: { id: 'asc' },
      where: { AND: [{ tenantId: A }] },
    });
  });

  it('scopes relations nested several levels deep, in select as well as include', () => {
    const scoped = scope('Customer', 'findMany', {
      select: { orders: { select: { lineItems: true } } },
    });

    expect(scoped.select.orders.where).toEqual({ AND: [{ tenantId: A }] });
    expect(scoped.select.orders.select.lineItems).toEqual({ where: { AND: [{ tenantId: A }] } });
  });

  it('selects the owner key of single relations so the result can be checked', () => {
    const scoped = scope('User', 'findUnique', {
      where: { id: 'u' },
      select: { tenant: { select: { isActive: true } } },
    });

    expect(scoped.select.tenant).toEqual({ select: { isActive: true, id: true } });
  });

  it('scopes _count of relations', () => {
    const scoped = scope('Order', 'findMany', { include: { _count: true } });

    expect(scoped.include._count).toEqual({
      select: { lineItems: { where: { AND: [{ tenantId: A }] } } },
    });
  });

  it('turns a single related record of another tenant into null and strips added keys', () => {
    const original = { customer: { select: { email: true } } };
    const scoped = scope('Order', 'findUnique', { where: { id: 1 }, select: original }).select;

    const leaked = verifyResult(
      'Order',
      { customer: { email: 'b@b.com', tenantId: B } },
      original,
      scoped,
      A,
    );
    const own = verifyResult(
      'Order',
      { customer: { email: 'a@a.com', tenantId: A } },
      original,
      scoped,
      A,
    );

    expect(leaked.customer).toBeNull();
    expect(own.customer).toEqual({ email: 'a@a.com' });
  });
});

describe('forTenant', () => {
  beforeEach(() => fake.reset());

  it.each([undefined, null, ''])('requires a tenantId (got %p)', (tenantId) => {
    expect(() => forTenant(tenantId)).toThrow('requires a tenantId');
  });

  it('only returns rows of its own tenant', async () => {
    fake.insert('customer', { tenantId: A, shopifyCustomerId: '1', email: 'a@a.com' });
    const other = fake.insert('customer', {
      tenantId: B,
      shopifyCustomerId: '1',
      email: 'b@b.com',
    });

    const db = forTenant(A);

    await expect(db.customer.findMany()).resolves.toHaveLength(1);
    await expect(db.customer.findUnique({ where: { id: other.id } })).resolves.toBeNull();
    await expect(db.customer.count()).resolves.toBe(1);
  });

  it('stamps its tenant on created rows', async () => {
    const created = await forTenant(A).product.create({
      data: { shopifyProductId: 'p1', title: 'Tee' },
    });

    expect(created.tenantId).toBe(A);
  });

  it('blocks raw SQL, which the extension cannot scope', async () => {
    await expect(forTenant(A).$queryRaw`SELECT 1`).rejects.toThrow('not tenant-scoped');
  });

  // Regression: query extensions only see the top-level query, so a line item owned by another
  // tenant (e.g. bad sync data) must not come back through an order's include.
  it("never returns another tenant's line item through an order's include", async () => {
    const order = fake.insert('order', { tenantId: A, shopifyOrderId: 'o1' });
    fake.insert('orderLineItem', {
      tenantId: A,
      orderId: order.id,
      shopifyLineItemId: 'own',
      title: 'Own',
    });
    fake.insert('orderLineItem', {
      tenantId: B,
      orderId: order.id,
      shopifyLineItemId: 'leak',
      title: 'Leak',
    });

    const result = await forTenant(A).order.findUnique({
      where: { id: order.id },
      include: { lineItems: true },
    });

    expect(result.lineItems.map((item) => item.title)).toEqual(['Own']);
  });

  it("returns null instead of another tenant's customer linked to an order", async () => {
    const otherCustomer = fake.insert('customer', { tenantId: B, shopifyCustomerId: 'c' });
    const order = fake.insert('order', {
      tenantId: A,
      shopifyOrderId: 'o1',
      customerId: otherCustomer.id,
    });

    const result = await forTenant(A).order.findUnique({
      where: { id: order.id },
      include: { customer: true },
    });

    expect(result.customer).toBeNull();
  });
});
