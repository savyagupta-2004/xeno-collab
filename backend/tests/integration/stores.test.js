const request = require('supertest');

jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const createApp = require('../../src/app');
const { decryptToken } = require('../../src/utils/tokenCipher');
const { fullSyncSteps } = require('../../src/services/sync.service');

const app = createApp({ nodeEnv: 'test' });

const TOKEN = 'shpat_live_secret_token';
const DOMAIN = 'asha-apparel.myshopify.com';
const ALL_SCOPES = ['read_customers', 'read_products', 'read_orders', 'read_checkouts'];

const shopifyResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});

const validStore = (scopes = ALL_SCOPES) =>
  shopifyResponse(200, {
    data: {
      shop: { name: 'Asha', myshopifyDomain: DOMAIN },
      currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) },
    },
  });

const owner = async (email = 'owner@store.com') => {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Owner', email, password: 'password-123', storeName: 'Store' });
  return { token: res.body.token, tenantId: res.body.tenant.id };
};

const connect = (token, body = { shopDomain: DOMAIN, accessToken: TOKEN }) =>
  request(app).post('/api/stores/connect').set('Authorization', `Bearer ${token}`).send(body);
const status = (token) =>
  request(app).get('/api/stores/status').set('Authorization', `Bearer ${token}`);

let shopify;

beforeEach(() => {
  fake.reset();
  fullSyncSteps.length = 0;
  shopify = jest.fn(async () => validStore());
  jest.spyOn(global, 'fetch').mockImplementation((...args) => shopify(...args));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/stores/connect', () => {
  it('checks the credentials with Shopify, then stores the token encrypted', async () => {
    const { token, tenantId } = await owner();

    const res = await connect(token, { shopDomain: 'asha-apparel', accessToken: ` ${TOKEN} ` });

    expect(res.status).toBe(200);
    const [url, init] = shopify.mock.calls[0];
    expect(url).toContain(`https://${DOMAIN}/admin/api/`);
    expect(init.headers['X-Shopify-Access-Token']).toBe(TOKEN);

    const [tenant] = fake.db.tenants;
    expect(tenant.shopDomain).toBe(DOMAIN);
    expect(tenant.shopifyAccessToken).not.toContain(TOKEN);
    expect(decryptToken(tenant.shopifyAccessToken, tenantId)).toBe(TOKEN);
  });

  it('never returns the token, encrypted or not', async () => {
    const { token } = await owner();

    const res = await connect(token);
    const after = await status(token);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    const stored = fake.db.tenants[0].shopifyAccessToken;
    for (const body of [res.body, after.body, me.body]) {
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(JSON.stringify(body)).not.toContain(stored);
      expect(JSON.stringify(body)).not.toMatch(/accessToken/i);
    }
  });

  it.each([
    [401, 'accessToken', 'Shopify rejected this access token'],
    [403, 'accessToken', 'Shopify rejected this access token'],
    [404, 'shopDomain', 'No Shopify store found at this domain'],
  ])('saves nothing when Shopify answers %i', async (code, field, message) => {
    const { token } = await owner();
    shopify.mockImplementation(async () => shopifyResponse(code, {}));

    const res = await connect(token);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'SHOPIFY_AUTH_FAILED',
      fields: { [field]: message },
    });
    expect(fake.db.tenants[0].shopDomain).toBeNull();
    expect(fake.db.tenants[0].shopifyAccessToken).toBeNull();
  });

  it('rejects a token missing the scopes ingestion needs', async () => {
    const { token } = await owner();
    shopify.mockImplementation(async () => validStore(['read_customers']));

    const res = await connect(token);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'MISSING_SCOPES',
      message: 'This access token is missing the scopes: read_products, read_orders',
    });
    expect(fake.db.tenants[0].shopDomain).toBeNull();
  });

  it('accepts write scopes, which include read', async () => {
    const { token } = await owner();
    shopify.mockImplementation(async () =>
      validStore(['write_customers', 'write_products', 'write_orders']),
    );

    expect((await connect(token)).status).toBe(200);
  });

  it('answers 424, not a logout, when Shopify is down', async () => {
    const { token } = await owner();
    shopify.mockImplementation(async () => {
      throw new TypeError('fetch failed');
    });
    const realSetTimeout = global.setTimeout;
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((fn, ms, ...rest) => realSetTimeout(fn, ms > 500 ? 0 : ms, ...rest));

    const res = await connect(token);

    expect(res.status).toBe(424);
    expect(res.body.error.code).toBe('SHOPIFY_UNAVAILABLE');
  });

  it('returns 409 when the store belongs to another tenant, and keeps it there', async () => {
    const first = await owner('first@store.com');
    const second = await owner('second@store.com');
    await connect(first.token);

    const res = await connect(second.token, {
      shopDomain: DOMAIN.toUpperCase(),
      accessToken: 'shpat_other',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORE_TAKEN');
    const [owned, other] = fake.db.tenants;
    expect(decryptToken(owned.shopifyAccessToken, first.tenantId)).toBe(TOKEN);
    expect(other.shopDomain).toBeNull();
    expect(other.shopifyAccessToken).toBeNull();
  });

  it('lets a tenant refresh the token of its own store', async () => {
    const { token, tenantId } = await owner();
    await connect(token);

    const res = await connect(token, { shopDomain: DOMAIN, accessToken: 'shpat_new' });

    expect(res.status).toBe(200);
    expect(decryptToken(fake.db.tenants[0].shopifyAccessToken, tenantId)).toBe('shpat_new');
  });

  it("refuses a second store on one tenant, so two stores' data never mix", async () => {
    const { token } = await owner();
    await connect(token);
    shopify.mockClear();

    const res = await connect(token, { shopDomain: 'other.myshopify.com', accessToken: 'x' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORE_CONNECTED');
    expect(shopify).not.toHaveBeenCalled();
  });

  it.each([
    [{}, { shopDomain: 'Shop domain is required', accessToken: 'Access token is required' }],
    [
      { shopDomain: 'evil.com', accessToken: 'x' },
      { shopDomain: 'Enter a valid myshopify.com domain' },
    ],
  ])('returns 400 for %j without calling Shopify', async (body, fields) => {
    const { token } = await owner();

    const res = await connect(token, body);

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual(fields);
    expect(shopify).not.toHaveBeenCalled();
  });

  it('fails before calling Shopify if the encryption key is not configured', async () => {
    const { token } = await owner();
    const key = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = '';

    const res = await connect(token);
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = key;

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(shopify).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    expect((await request(app).post('/api/stores/connect').send({})).status).toBe(401);
  });
});

describe('first full sync', () => {
  it('starts automatically, after the store is saved', async () => {
    const { token, tenantId } = await owner();
    let domainDuringSync;
    const step = jest.fn(async () => {
      domainDuringSync = fake.db.tenants[0].shopDomain;
    });
    fullSyncSteps.push(step);

    const res = await connect(token);

    expect(res.body.firstSyncStarted).toBe(true);
    expect(step).toHaveBeenCalledWith(tenantId);
    expect(domainDuringSync).toBe(DOMAIN);
  });

  it('does not fail the connect when the sync fails', async () => {
    const { token } = await owner();
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    fullSyncSteps.push(async () => {
      throw new Error('sync broke');
    });

    const res = await connect(token);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.status).toBe(200);
    expect(logged.mock.calls.flat().join(' ')).toContain('sync broke');
  });

  it('reports honestly that no sync ran while no sync step exists', async () => {
    const { token } = await owner();

    expect((await connect(token)).body.firstSyncStarted).toBe(false);
  });

  it('does not start when connecting fails', async () => {
    const { token } = await owner();
    const step = jest.fn(async () => {});
    fullSyncSteps.push(step);
    shopify.mockImplementation(async () => shopifyResponse(401, {}));

    await connect(token);

    expect(step).not.toHaveBeenCalled();
  });
});

describe('GET /api/stores/status', () => {
  it('reports a tenant with no store', async () => {
    const { token } = await owner();

    const res = await status(token);

    expect(res.status).toBe(200);
    expect(res.body.store).toEqual({
      shopDomain: null,
      connected: false,
      lastSyncedAt: null,
      counts: { customers: 0, products: 0, orders: 0 },
    });
  });

  it('returns domain, connected flag, last sync and counts for the caller only', async () => {
    const mine = await owner('mine@store.com');
    const other = await owner('other@store.com');
    await connect(mine.token);
    const lastSyncedAt = new Date('2026-11-01T10:00:00Z');
    fake.db.tenants[0].lastSyncedAt = lastSyncedAt;
    fake.insert('customer', { tenantId: mine.tenantId, shopifyCustomerId: '1' });
    fake.insert('customer', { tenantId: other.tenantId, shopifyCustomerId: '1' });
    fake.insert('customer', { tenantId: other.tenantId, shopifyCustomerId: '2' });
    fake.insert('product', { tenantId: mine.tenantId, shopifyProductId: '1' });
    fake.insert('order', { tenantId: other.tenantId, shopifyOrderId: '1' });

    const res = await status(mine.token);

    expect(res.body.store).toEqual({
      shopDomain: DOMAIN,
      connected: true,
      lastSyncedAt: lastSyncedAt.toISOString(),
      counts: { customers: 1, products: 1, orders: 0 },
    });
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/stores/status')).status).toBe(401);
  });
});
