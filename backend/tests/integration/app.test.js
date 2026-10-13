const request = require('supertest');
const express = require('express');
const createApp = require('../../src/app');
const errorHandler = require('../../src/middleware/errorHandler');
const AppError = require('../../src/utils/AppError');

describe('App skeleton', () => {
  const app = createApp({ nodeEnv: 'test' });

  it('GET /api/health returns 200 with status and timestamp', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('unknown routes return 404 JSON', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { message: 'Route not found: GET /api/does-not-exist', code: 'NOT_FOUND' },
    });
  });

  it('malformed JSON returns 400 JSON', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('Global error handler', () => {
  const buildApp = (err) => {
    const app = express();
    app.get('/boom', () => {
      throw err;
    });
    app.use(errorHandler);
    return app;
  };

  it('returns AppError message and code', async () => {
    const res = await request(buildApp(new AppError('Nope', 422, 'VALIDATION_ERROR'))).get('/boom');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: { message: 'Nope', code: 'VALIDATION_ERROR' } });
  });

  it('hides details of unexpected errors', async () => {
    const res = await request(buildApp(new Error('db password leaked'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
    });
  });
});
