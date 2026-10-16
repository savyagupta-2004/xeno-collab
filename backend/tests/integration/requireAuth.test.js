const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/prisma', () => ({
  prisma: require('../helpers/fakePrisma').prisma,
  checkDatabaseConnection: jest.fn(),
}));

const fake = require('../helpers/fakePrisma');
const requireAuth = require('../../src/middleware/requireAuth');
const errorHandler = require('../../src/middleware/errorHandler');
const { signToken } = require('../../src/utils/jwt');

// Minimal app that echoes what requireAuth attached to the request.
const app = express();
app.get('/whoami', requireAuth, (req, res) => res.json({ user: req.user, tenantId: req.tenantId }));
app.use(errorHandler);

beforeEach(() => fake.reset());

it('sets req.user and req.tenantId from a valid token', async () => {
  const tenant = fake.insert('tenant', { name: 'Store' });
  const user = fake.insert('user', {
    tenantId: tenant.id,
    name: 'Asha',
    email: 'asha@store.com',
    passwordHash: 'secret-hash',
  });

  const res = await request(app)
    .get('/whoami')
    .set('Authorization', `Bearer ${signToken({ userId: user.id, tenantId: tenant.id })}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    tenantId: tenant.id,
    user: { id: user.id, tenantId: tenant.id, name: 'Asha', email: 'asha@store.com' },
  });
});

it('returns 401 when the user no longer exists', async () => {
  const tenant = fake.insert('tenant', { name: 'Store' });

  const res = await request(app)
    .get('/whoami')
    .set('Authorization', `Bearer ${signToken({ userId: 'deleted-user', tenantId: tenant.id })}`);

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHORIZED');
});

it.each(['Basic abc', 'Bearer', 'bearer token'])(
  'returns 401 for a malformed header "%s"',
  async (header) => {
    const res = await request(app).get('/whoami').set('Authorization', header);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  },
);
