const { z } = require('zod');
const { normalizeShopDomain } = require('../services/shopify/client');

const isShopDomain = (value) => {
  try {
    normalizeShopDomain(value);
    return true;
  } catch {
    return false;
  }
};

const connectStoreSchema = z.object({
  shopDomain: z
    .string('Shop domain is required')
    .trim()
    .min(1, 'Shop domain is required')
    .refine(isShopDomain, 'Enter a valid myshopify.com domain')
    .transform(normalizeShopDomain),
  accessToken: z
    .string('Access token is required')
    .trim()
    .min(1, 'Access token is required')
    .max(512, 'Access token is too long'),
});

module.exports = { connectStoreSchema };
