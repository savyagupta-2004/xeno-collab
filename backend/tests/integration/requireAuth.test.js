const { randomUUID } = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
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

const whoami = (authorization) => request(app).get('/whoami').set('Authorization', authorization);

let tenant;
let user;
let validToken;

beforeEach(() => {
  fake.reset();
  tenant = fake.insert('tenant', { name: 'Store' });
  user = fake.insert('user', {
    tenantId: tenant.id,
    name: 'Asha',
    email: 'asha@store.com',
    passwordHash: 'secret-hash',
  });
  validToken = signToken({ userId: user.id, tenantId: tenant.id });
});

it('sets req.user and req.tenantId from a valid token', async () => {
  const res = await whoami(`Bearer ${validToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    tenantId: tenant.id,
    user: { id: user.id, tenantId: tenant.id, name: 'Asha', email: 'asha@store.com' },
  });
});

it('accepts the scheme name in any letter case (RFC 7235)', async () => {
  const res = await whoami(`bearer ${validToken}`);

  expect(res.status).toBe(200);
});

it('returns 401 when the user no longer exists', async () => {
  const res = await whoami(`Bearer ${signToken({ userId: randomUUID(), tenantId: tenant.id })}`);

  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHORIZED');
});

describe('only accepts exactly "Bearer <jwt>"', () => {
  it.each([
    ['another scheme', (t) => `Basic ${t}`],
    ['a made-up scheme', (t) => `Token ${t}`],
    ['no scheme at all', (t) => t],
    ['extra parts after the token', (t) => `Bearer ${t} extra`],
    ['two spaces', (t) => `Bearer  ${t}`],
    ['scheme only', () => 'Bearer'],
    ['a value that is not a JWT', () => 'Bearer not-a-jwt'],
  ])('returns 401 for %s, even with a valid token', async (_label, makeHeader) => {
    const res = await whoami(makeHeader(validToken));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('validates claim types before touching the database', () => {
  // Correctly signed tokens whose claims have the wrong type or shape.
  it.each([
    ['userId is a number', () => ({ userId: 42, tenantId: tenant.id })],
    ['tenantId is a number', () => ({ userId: user.id, tenantId: 7 })],
    ['userId is an object', () => ({ userId: { id: user.id }, tenantId: tenant.id })],
    ['tenantId is an array', () => ({ userId: user.id, tenantId: [tenant.id] })],
    ['userId is not a UUID', () => ({ userId: 'admin', tenantId: tenant.id })],
    ['tenantId is not a UUID', () => ({ userId: user.id, tenantId: "1' OR '1'='1" })],
    ['claims are null', () => ({ userId: null, tenantId: null })],
    ['claims are missing', () => ({})],
  ])('returns 401 (not 500) when %s', async (_label, makeClaims) => {
    const token = jwt.sign(makeClaims(), process.env.JWT_SECRET);
    const findUnique = jest.spyOn(fake.prisma.user, 'findUnique');

    const res = await whoami(`Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toEqual({ message: 'Invalid token', code: 'UNAUTHORIZED' });
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockRestore();
  });
});
