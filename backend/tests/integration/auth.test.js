const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const createApp = require('../../src/app');

const app = createApp({ nodeEnv: 'test' });
const SECRET = process.env.JWT_SECRET;

const validRegistration = {
  name: 'Asha Rao',
  email: '  Asha@Store.com ',
  password: 'correct-horse-1',
  storeName: 'Asha Apparel',
};

const register = (body = validRegistration) => request(app).post('/api/auth/register').send(body);
const login = (body) => request(app).post('/api/auth/login').send(body);
const me = (token) => {
  const req = request(app).get('/api/auth/me');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};

beforeEach(() => fake.reset());

describe('POST /api/auth/register', () => {
  it('creates tenant + user and returns a JWT with userId and tenantId', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha Rao', email: 'asha@store.com' });
    expect(res.body.tenant).toMatchObject({ name: 'Asha Apparel', shopDomain: null });
    expect(fake.db.tenants).toHaveLength(1);
    expect(fake.db.users).toHaveLength(1);

    const payload = jwt.verify(res.body.token, SECRET);
    expect(payload.userId).toBe(res.body.user.id);
    expect(payload.tenantId).toBe(res.body.tenant.id);
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
  });

  it('stores a bcrypt hash with cost >= 10 and never returns it', async () => {
    const res = await register();
    const stored = fake.db.users[0].passwordHash;

    expect(stored).not.toBe(validRegistration.password);
    expect(bcrypt.getRounds(stored)).toBeGreaterThanOrEqual(10);
    await expect(bcrypt.compare(validRegistration.password, stored)).resolves.toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('returns 409 for a duplicate email (any letter case) and rolls back the new tenant', async () => {
    await register();
    const res = await register({
      ...validRegistration,
      email: 'ASHA@store.com',
      storeName: 'Other',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(fake.db.tenants).toHaveLength(1);
    expect(fake.db.users).toHaveLength(1);
  });

  it('returns 400 with an error per invalid field', async () => {
    const res = await register({ name: '', email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.fields).toEqual({
      name: 'Name is required',
      email: 'Enter a valid email address',
      password: 'Password must be at least 8 characters',
      storeName: 'Store name is required',
    });
    expect(fake.db.tenants).toHaveLength(0);
  });

  it('returns 400 when the body is missing', async () => {
    const res = await request(app).post('/api/auth/register');

    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(['name', 'email', 'password', 'storeName']);
  });

  it('rejects passwords longer than bcrypt can use (72 bytes)', async () => {
    const res = await register({ ...validRegistration, password: 'a'.repeat(73) });

    expect(res.status).toBe(400);
    expect(res.body.error.fields.password).toBe('Password is too long');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await register();
  });

  it('returns a 24h JWT with userId and tenantId, and the profile without the password', async () => {
    const res = await login({ email: 'ASHA@store.com', password: validRegistration.password });

    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.token, SECRET);
    expect(payload).toMatchObject({ userId: res.body.user.id, tenantId: res.body.tenant.id });
    expect(payload.exp - payload.iat).toBe(24 * 60 * 60);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('returns the same generic 401 for a wrong password and an unknown email', async () => {
    const wrongPassword = await login({ email: 'asha@store.com', password: 'wrong-password' });
    const unknownEmail = await login({ email: 'nobody@store.com', password: 'whatever-123' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({
      error: { message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' },
    });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('returns 400 with field errors for an invalid payload', async () => {
    const res = await login({ email: 'nope' });

    expect(res.status).toBe(400);
    expect(res.body.error.fields).toEqual({
      email: 'Enter a valid email address',
      password: 'Password is required',
    });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the user and tenant profile for a valid token', async () => {
    const { body } = await register();
    fake.db.tenants[0].shopifyAccessToken = 'shpat_secret_value';

    const res = await me(body.token);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: body.user.id, email: 'asha@store.com' });
    expect(res.body.tenant).toMatchObject({ id: body.tenant.id, name: 'Asha Apparel' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|shpat_|accessToken/i);
  });

  it('returns 401 without a token', async () => {
    const res = await me();

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['malformed', () => 'not-a-jwt'],
    ['signed with another secret', () => jwt.sign({ userId: 'u', tenantId: 't' }, 'other-secret')],
    ['expired', () => jwt.sign({ userId: 'u', tenantId: 't' }, SECRET, { expiresIn: -10 })],
    ['missing tenantId', () => jwt.sign({ userId: 'u' }, SECRET)],
  ])('returns 401 for a %s token', async (_label, makeToken) => {
    const res = await me(makeToken());

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it("returns 401 when the token's tenantId doesn't own the user", async () => {
    const first = await register();
    const second = await register({ ...validRegistration, email: 'ravi@other.com' });
    const crossTenant = jwt.sign(
      { userId: first.body.user.id, tenantId: second.body.tenant.id },
      SECRET,
    );

    const res = await me(crossTenant);

    expect(res.status).toBe(401);
  });
});
