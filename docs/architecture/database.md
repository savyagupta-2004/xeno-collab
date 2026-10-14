# Database schema

PostgreSQL, managed by Prisma. Source of truth: [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma).
Migrations live in [`backend/prisma/migrations`](../../backend/prisma/migrations).

## ER diagram

```mermaid
erDiagram
    tenants ||--o{ users : "has"
    tenants ||--o{ customers : "owns"
    tenants ||--o{ products : "owns"
    tenants ||--o{ orders : "owns"
    tenants ||--o{ order_line_items : "owns"
    tenants ||--o{ events : "owns"
    tenants ||--o{ sync_logs : "owns"
    customers |o--o{ orders : "places (null = guest)"
    orders ||--|{ order_line_items : "contains"
    products |o--o{ order_line_items : "sold as"
    customers |o--o{ events : "triggers"

    tenants {
        uuid id PK
        text name
        text shop_domain UK "nullable until store is connected"
        text shopify_access_token
        varchar currency
        boolean is_active
        timestamptz last_synced_at
        timestamptz created_at
        timestamptz updated_at
    }
    users {
        uuid id PK
        uuid tenant_id FK
        text email UK
        text password_hash
        text name
        timestamptz created_at
        timestamptz updated_at
    }
    customers {
        int id PK
        uuid tenant_id FK
        text shopify_customer_id "UK with tenant_id"
        text email
        text first_name
        text last_name
        text phone
        int orders_count
        decimal total_spent
        varchar currency
        timestamptz created_at "from Shopify"
        timestamptz updated_at "from Shopify"
        timestamptz synced_at
    }
    products {
        int id PK
        uuid tenant_id FK
        text shopify_product_id "UK with tenant_id"
        text title
        text vendor
        text product_type
        text status
        decimal price
        timestamptz created_at "from Shopify"
        timestamptz updated_at "from Shopify"
        timestamptz synced_at
    }
    orders {
        int id PK
        uuid tenant_id FK
        text shopify_order_id "UK with tenant_id"
        text order_number
        int customer_id FK "nullable"
        text email
        varchar currency
        decimal subtotal_price
        decimal total_discounts
        decimal total_tax
        decimal total_price
        text financial_status
        text fulfillment_status
        timestamptz cancelled_at
        timestamptz created_at "from Shopify"
        timestamptz updated_at "from Shopify"
        timestamptz synced_at
    }
    order_line_items {
        int id PK
        uuid tenant_id FK
        int order_id FK
        int product_id FK "nullable"
        text shopify_line_item_id "UK with tenant_id"
        text shopify_product_id
        text title
        text variant_title
        text sku
        int quantity
        decimal price "unit price"
    }
    events {
        int id PK
        uuid tenant_id FK
        event_type type "checkout_started | cart_abandoned"
        int customer_id FK "nullable"
        text shopify_checkout_id
        text email
        decimal total_price
        varchar currency
        jsonb payload
        timestamptz occurred_at
        timestamptz created_at
    }
    sync_logs {
        int id PK
        uuid tenant_id FK
        sync_resource resource "customers | products | orders | events"
        sync_trigger trigger "manual | scheduler | webhook"
        sync_status status "running | success | failed"
        int records_synced
        text error_message
        timestamptz started_at
        timestamptz finished_at
    }
```

## Tables

| Table | One row per | Notes |
|---|---|---|
| `tenants` | Retailer / Shopify store | `shop_domain` is unique; null until the store is connected |
| `users` | Dashboard login | Belongs to one tenant; `email` unique across the platform |
| `customers` | Shopify customer | Unique on `(tenant_id, shopify_customer_id)` |
| `products` | Shopify product | Unique on `(tenant_id, shopify_product_id)`; `price` is the lowest variant price |
| `orders` | Shopify order | Unique on `(tenant_id, shopify_order_id)`; `customer_id` null for guest checkout |
| `order_line_items` | Line in an order | Unique on `(tenant_id, shopify_line_item_id)` |
| `events` | Checkout started / cart abandoned | Unique on `(tenant_id, type, shopify_checkout_id)` so webhook retries don't duplicate |
| `sync_logs` | Sync run | What was synced, how it was triggered, how many records, success or error |

## Conventions

- **Naming:** tables and columns are `snake_case` in SQL (`orders.total_price`); Prisma exposes them as `camelCase` in JS (`order.totalPrice`).
- **Tenant isolation:** every Shopify-derived table has a `tenant_id` foreign key to `tenants`, and an index that starts with `tenant_id` (the composite unique keys double as that index). Every query in the app must filter by `tenant_id`.
- **No duplicates on re-sync:** the `(tenant_id, shopify_*_id)` unique keys let sync code upsert safely.
- **Money:** `DECIMAL(12,2)`, never floating point.
- **Time:** `TIMESTAMPTZ`. On Shopify tables `created_at` / `updated_at` are Shopify's values (when the order was really placed); `synced_at` is when we last wrote the row.
- **Shopify IDs** are stored as text: they are identifiers, not numbers.
- **Deletes:** deleting a tenant deletes all its data (`ON DELETE CASCADE`). Deleting a customer or product keeps orders and line items and sets the reference to `NULL`.

## Example queries

```sql
-- Total customers, orders and revenue for one tenant
SELECT
  (SELECT count(*) FROM customers WHERE tenant_id = $1) AS total_customers,
  (SELECT count(*) FROM orders    WHERE tenant_id = $1) AS total_orders,
  (SELECT coalesce(sum(total_price), 0) FROM orders WHERE tenant_id = $1) AS total_revenue;

-- Orders and revenue per day in a date range
SELECT date_trunc('day', created_at)::date AS day, count(*) AS orders, sum(total_price) AS revenue
FROM orders
WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
GROUP BY day
ORDER BY day;

-- Top 5 customers by spend
SELECT c.first_name, c.last_name, c.email, sum(o.total_price) AS spend
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE o.tenant_id = $1
GROUP BY c.id
ORDER BY spend DESC
LIMIT 5;
```

## Known limitations

- `orders.customer_id` (and the other in-tenant references) only checks that the row exists, not that it belongs to the same tenant. Enforcing that in SQL needs composite foreign keys on `(tenant_id, id)`, which can't be combined with `ON DELETE SET NULL` in Prisma. Tenant scoping is enforced in the application layer instead.
- `tenants.shopify_access_token` is stored as plain text for v1; it should be encrypted at rest before production.

## Working with the schema

```bash
cd backend
npx prisma migrate status                # which migrations are applied (read-only)
npx prisma migrate deploy                # apply committed migrations (use this on the shared DB)
npx prisma migrate dev --name <change>   # create a new migration after editing schema.prisma
npx prisma db seed                       # create the demo tenant (safe to re-run)
npx prisma studio                        # browse data in the browser
```
