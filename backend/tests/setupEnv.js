// Runs before every test file. Gives config/env.js the variables it requires,
// without needing a real database or a developer's backend/.env.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-jwt-secret';
process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY =
  process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
