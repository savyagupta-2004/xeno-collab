const { z } = require('zod');
const { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } = require('../config/auth');

const requiredText = (label, max = 100) =>
  z
    .string(`${label} is required`)
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

// Emails are stored lowercase so "Asha@Shop.com" and "asha@shop.com" are the same account.
const email = z
  .string('Email is required')
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

const registerSchema = z.object({
  name: requiredText('Name'),
  email,
  password: z
    .string('Password is required')
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES,
      'Password is too long',
    ),
  storeName: requiredText('Store name'),
});

// Login doesn't repeat the password rules: any wrong password is just "invalid credentials".
const loginSchema = z.object({
  email,
  password: z.string('Password is required').min(1, 'Password is required'),
});

module.exports = { registerSchema, loginSchema };
