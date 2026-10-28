#!/usr/bin/env node
// Prints a fresh Admin API access token for the store in backend/.env (valid 24 hours for
// Dev Dashboard apps), plus the scopes it grants. Useful for curl testing or sharing privately.
//
//   npm run shopify:token
//
// The token is a secret: don't paste it into chat, tickets, commits or screenshots.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const { getAccessToken } = require('./shopify/client');

getAccessToken(process.env)
  .then(({ domain, accessToken, scope, expiresIn, source }) => {
    console.log(`Store : ${domain}`);
    console.log(`Source: ${source}`);
    if (scope) console.log(`Scopes: ${scope}`);
    if (expiresIn) console.log(`Valid : ${Math.round(expiresIn / 3600)} hours`);
    console.log(`Token : ${accessToken}`);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
