jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const { forTenant, scopeArgs } = require('../../src/services/tenantDb');

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

  it('rejects models that are not classified, so a new table cannot be left unscoped', () => {
    expect(() => scope('Webhook', 'findMany', {})).toThrow('not classified');
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
});
