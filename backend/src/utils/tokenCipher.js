// AES-256-GCM encryption for Shopify access tokens stored in tenants.shopify_access_token.
// Stored as "v1:<iv>:<auth tag>:<ciphertext>" (base64). The tenant id is authenticated with the
// data, so a value copied onto another tenant's row fails to decrypt.
const crypto = require('crypto');
const { getTokenEncryptionKey } = require('../config/shopify');

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;

const encryptToken = (token, tenantId) => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getTokenEncryptionKey(), iv);
  cipher.setAAD(Buffer.from(tenantId));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (Buffer.isBuffer(part) ? part.toString('base64') : part))
    .join(':');
};

// Throws if the value was tampered with, or belongs to another tenant or key.
const decryptToken = (stored, tenantId) => {
  const [version, iv, authTag, ciphertext] = String(stored).split(':');
  if (version !== VERSION || !iv || !authTag || !ciphertext) {
    throw new Error('Stored Shopify token has an unknown format');
  }
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getTokenEncryptionKey(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAAD(Buffer.from(tenantId));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

module.exports = { encryptToken, decryptToken };
