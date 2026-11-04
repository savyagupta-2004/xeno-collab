const { encryptToken, decryptToken } = require('../../src/utils/tokenCipher');

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'shpat_secret_value';

describe('tokenCipher', () => {
  const originalKey = process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY;

  afterEach(() => {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a token and never stores it in readable form', () => {
    const stored = encryptToken(TOKEN, TENANT);

    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain(TOKEN);
    expect(decryptToken(stored, TENANT)).toBe(TOKEN);
  });

  it('uses a new IV every time, so equal tokens look different', () => {
    expect(encryptToken(TOKEN, TENANT)).not.toBe(encryptToken(TOKEN, TENANT));
  });

  it('rejects a tampered value', () => {
    const parts = encryptToken(TOKEN, TENANT).split(':');
    const bytes = Buffer.from(parts[3], 'base64');
    bytes[0] ^= 1;
    parts[3] = bytes.toString('base64');

    expect(() => decryptToken(parts.join(':'), TENANT)).toThrow();
  });

  it("rejects a value copied onto another tenant's row", () => {
    expect(() => decryptToken(encryptToken(TOKEN, TENANT), OTHER_TENANT)).toThrow();
  });

  it('rejects a value encrypted with a different key', () => {
    const stored = encryptToken(TOKEN, TENANT);
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

    expect(() => decryptToken(stored, TENANT)).toThrow();
  });

  it.each([
    ['missing', ''],
    ['too short', Buffer.alloc(16).toString('base64')],
  ])('refuses a %s key', (_label, key) => {
    process.env.SHOPIFY_TOKEN_ENCRYPTION_KEY = key;

    expect(() => encryptToken(TOKEN, TENANT)).toThrow('must be 32 bytes');
  });
});
