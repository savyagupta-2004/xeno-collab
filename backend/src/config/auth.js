module.exports = {
  // bcrypt work factor: 2^12 rounds (~250ms per hash). Story requires 10 or higher.
  BCRYPT_SALT_ROUNDS: 12,
  JWT_EXPIRES_IN: '24h',
  JWT_ALGORITHM: 'HS256',
  PASSWORD_MIN_LENGTH: 8,
  // bcrypt only uses the first 72 bytes of a password
  PASSWORD_MAX_BYTES: 72,
};
