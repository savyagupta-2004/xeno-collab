# Shopify dev store setup

How to create the two Shopify development stores the project ingests from, the app that gives
our backend API access, and the demo data. **No secrets belong in this file or anywhere in git.**
Client secrets and access tokens are shared privately (DM or password manager) and live only in
`backend/.env`.

| Store                            | Purpose                                  | Data                                               |
| -------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| Main (e.g. `xeno-demo-main`)     | Build and test ingestion, dashboard demo | 24 products, 32 customers, 55 orders over ~45 days |
| Second (e.g. `xeno-demo-second`) | Multi-tenancy tests (tenant isolation)   | 6 products, 6 customers, 12 orders                 |

Both include cancelled orders, refunded orders and guest checkouts. The demo data is created by a
script (`backend/scripts/seed-shopify.js`), so it is identical every time.

## 1. Account and stores

1. Sign up for a free Shopify developer account and open the **Dev Dashboard**
   (dev.shopify.com/dashboard). It creates an organization for you.
2. **Stores → Create store → Dev**. Name it (the name becomes the permanent
   `<name>.myshopify.com` address), pick any plan (e.g. Basic) and create it.
3. Repeat for the second store.

> Create the stores from the Dev Dashboard, not from inside another store's admin. The app's
> client credentials only work for stores in the same organization as the app.

In **each** store's admin:

- **Currency:** Settings → General → Store defaults → Currency → **Indian Rupee (INR)**. The
  platform is INR-only; the seeding script refuses to run on a store in another currency. Do this
  before any orders exist.
- **Test payments:** Settings → Payments → enable test mode (or Shopify's test/"Bogus" gateway),
  so checkouts can be completed without real money.
- **Storefront password:** dev stores are always password protected. Find it under
  Online Store → Preferences; you need it to open the storefront for test checkouts.

## 2. Apps

We use two apps in the Dev Dashboard. Keeping the seeder separate means the app our backend uses
for ingestion only ever has **read** access.

| App               | Scopes                                                             | Used by                                 |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------- |
| **Xeno Insights** | `read_customers`, `read_orders`, `read_products`, `read_checkouts` | The backend (ingestion, from XENO-9 on) |
| **Xeno Seeder**   | `write_customers`, `write_orders`, `write_products`                | `npm run seed:shopify` only             |

`read_orders` also covers abandoned checkouts (the bonus events). Orders older than 60 days would
additionally need `read_all_orders`; the seed data stays within 45 days.

For each app:

1. Dev Dashboard → **Apps → Create app → Start from Dev Dashboard**, enter the name, **Create**.
2. On **Versions**: keep the default App URL (`https://shopify.dev/apps/default-app-home`), pick
   the newest Webhooks API version, select the **Scopes** from the table above, then **Release**.
3. **Protected customer data:** customer names and emails are protected. In the app's settings,
   request access to protected customer data and the **Name** and **Email** fields. Apps
   installed only on development stores don't need Shopify's review. Without this, names and
   emails come back as `null`.
4. **Install** it: on the app page, **Installs → Install app**, choose the store, **Install**.
   Install both apps on both stores.
5. **App settings → Credentials**: this has the **Client ID** and **Client secret**. Treat the
   secret like a password.

### Access tokens

Dev Dashboard apps don't show a permanent token. Our scripts exchange the Client ID and secret for
an Admin API access token (OAuth _client credentials grant_), valid for **24 hours**, whenever they
run. To see a token, e.g. for curl testing:

```bash
cd backend
npm run shopify:token
```

**Fallback, legacy custom apps (story XENO-8 AC7):** older stores may have **Settings → Apps and
sales channels → Develop apps** in the store admin. Shopify is phasing this out, and new stores
may not show it; use the Dev Dashboard flow above when it's missing. If you do use it, the admin
shows an Admin API access token (`shpat_…`) once, after installing. Put it in
`SHOPIFY_ADMIN_TOKEN` instead of the client ID and secret.

## 3. Seed the demo data

Put the **Xeno Seeder** credentials for the store you want to seed in `backend/.env` (these lines
are in `backend/.env.example`):

```
SHOPIFY_STORE_DOMAIN=xeno-demo-main.myshopify.com
SHOPIFY_CLIENT_ID=<seeder app client id>
SHOPIFY_CLIENT_SECRET=<seeder app client secret>
```

Then, from `backend/`:

```bash
npm run seed:shopify -- --dry-run      # shows what will be created, no API calls
npm run seed:shopify                   # main store
```

For the second store, change `SHOPIFY_STORE_DOMAIN` to the second store and run:

```bash
npm run seed:shopify -- --size small
```

Notes:

- **It takes about 11 minutes** for the main store: development stores accept at most 5 new orders
  per minute, so the script spaces them out.
- **Safe to re-run.** Everything it creates is tagged `xeno-seed`; existing products, customers
  and orders are skipped, so an interrupted run just continues.
- Order dates are back-dated (`processedAt`) across the last ~45 days. No emails are sent:
  receipts are off and every address is `@example.com`.
- Afterwards, switch `backend/.env` back to the **Xeno Insights** (read-only) credentials for
  normal development.

## 4. Test checkouts and abandoned carts

The bonus "checkout started / cart abandoned" events need real storefront checkouts, which the
Admin API can't create. On the **main** store (and one or two on the second):

1. Open `https://<store>.myshopify.com` and enter the storefront password.
2. **Completed checkouts (3):** add products to the cart, check out with an `@example.com` email,
   and pay with the test gateway's success card.
3. **Abandoned carts (4):** add products, go to checkout, enter an `@example.com` email and a
   shipping address, then close the tab without paying. Shopify lists these under
   **Orders → Abandoned checkouts** after a while.

## 5. Check it worked

In each store's admin: **Products**, **Customers** and **Orders** show the seeded records (filter
by tag `xeno-seed`). There are cancelled and refunded orders, a few orders without a customer
(guest checkouts), and order dates spread over several weeks.

## 6. Sharing and secrets

- Share the **Xeno Insights** Client ID and secret (and store domains) with the team privately.
  Never paste them into GitHub, Jira, Slack channels or screenshots.
- `backend/.env` is git-ignored; only `backend/.env.example` (with empty values) is committed.
- If a secret leaks, rotate it in the Dev Dashboard (**App settings → Credentials**).

## Notes for the ingestion stories

- Tokens from the client credentials grant **expire after 24 hours**, so the backend must request
  a fresh one when needed (or when Shopify returns 401) rather than storing a single token forever.
- The client credentials grant only works for stores in our own Dev Dashboard organization, which
  is true for both dev stores. A real merchant's store would need the authorization code grant.
- The Admin GraphQL API version used by the scripts is `2026-10` (override with
  `SHOPIFY_API_VERSION` in `backend/.env`).
