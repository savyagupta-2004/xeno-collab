// Shopify settings. Kept separate from config/env.js so tools that only talk to Shopify
// (backend/scripts) don't also need DATABASE_URL and JWT_SECRET.
require('dotenv').config({ quiet: true });

const DEFAULT_SHOPIFY_API_VERSION = '2026-10';

// Shopify releases quarterly versions (2026-01, -04, -07, -10) plus "unstable".
const API_VERSION_FORMAT = /^(\d{4}-(01|04|07|10)|unstable)$/;

// Read when a client is created (not at load time), so a changed env is picked up.
const getShopifyApiVersion = () => {
  const version = process.env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION;
  if (!API_VERSION_FORMAT.test(version)) {
    throw new Error(
      `SHOPIFY_API_VERSION "${version}" is not a Shopify API version (e.g. ${DEFAULT_SHOPIFY_API_VERSION})`,
    );
  }
  return version;
};

module.exports = { DEFAULT_SHOPIFY_API_VERSION, getShopifyApiVersion };
