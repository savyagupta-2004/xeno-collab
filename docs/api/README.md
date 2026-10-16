# API Reference

Base URL (local): `http://localhost:5000/api`

## Authentication

Protected endpoints need the JWT from register/login in the `Authorization` header:

```
Authorization: Bearer <token>
```

The token is valid for 24 hours and carries `userId` and `tenantId`. If the store is deactivated,
existing tokens are rejected immediately with `403 TENANT_INACTIVE`. An expired token returns
`401 TOKEN_EXPIRED`.

Every protected endpoint only sees the caller's own tenant. Asking for another tenant's record
returns `404 NOT_FOUND`, exactly like a record that doesn't exist.

## Error format

Every error response has this shape:

```json
{ "error": { "message": "Human readable message", "code": "MACHINE_CODE" } }
```

| Status | Code                  | When                                                         |
| ------ | --------------------- | ------------------------------------------------------------ |
| 400    | `INVALID_JSON`        | Request body is not valid JSON                               |
| 400    | `VALIDATION_ERROR`    | Request body fails validation (see `fields` below)           |
| 401    | `UNAUTHORIZED`        | Missing or invalid token                                     |
| 401    | `TOKEN_EXPIRED`       | The token has expired; log in again                          |
| 401    | `INVALID_CREDENTIALS` | Wrong email or password (same message for both)              |
| 403    | `TENANT_INACTIVE`     | The store has been deactivated                               |
| 404    | `NOT_FOUND`           | Route or record not found (incl. another tenant's record)    |
| 409    | `EMAIL_TAKEN`         | An account with this email already exists                    |
| 500    | `INTERNAL_ERROR`      | Unexpected server error (details are logged, never returned) |

Validation errors also include `fields`, one message per invalid field:

```json
{
  "error": {
    "message": "Invalid request body",
    "code": "VALIDATION_ERROR",
    "fields": { "email": "Enter a valid email address" }
  }
}
```

## Health

### `GET /api/health`

Public. Reports whether the API is running and whether it can reach the database
(`SELECT 1`, 3 second timeout).

**200**: API and database are up

```json
{ "status": "ok", "db": "up", "timestamp": "2026-10-13T12:00:00.000Z" }
```

**503**: API is running but the database is unreachable

```json
{ "status": "degraded", "db": "down", "timestamp": "2026-10-13T12:00:00.000Z" }
```

## Auth

### `POST /api/auth/register`

Public. Creates a tenant (store) and its owner account in one transaction and logs them in.

**Body**

| Field       | Rules                                          |
| ----------- | ---------------------------------------------- |
| `name`      | Required, max 100 characters                   |
| `email`     | Required, valid email; stored lowercase        |
| `password`  | Required, at least 8 characters (max 72 bytes) |
| `storeName` | Required, max 100 characters                   |

```json
{
  "name": "Asha Rao",
  "email": "asha@store.com",
  "password": "correct-horse-1",
  "storeName": "Asha Apparel"
}
```

**201**

```json
{
  "token": "<jwt>",
  "user": {
    "id": "623d99c0-…",
    "tenantId": "97005473-…",
    "name": "Asha Rao",
    "email": "asha@store.com",
    "createdAt": "2026-10-15T13:18:05.432Z"
  },
  "tenant": {
    "id": "97005473-…",
    "name": "Asha Apparel",
    "shopDomain": null,
    "isActive": true,
    "lastSyncedAt": null,
    "createdAt": "2026-10-15T13:18:05.429Z"
  }
}
```

Errors: `400 VALIDATION_ERROR`, `409 EMAIL_TAKEN`.

### `POST /api/auth/login`

Public.

**Body**: `{ "email": "asha@store.com", "password": "correct-horse-1" }`

**200**: same shape as register (`token`, `user`, `tenant`).

Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `403 TENANT_INACTIVE` (only after a
correct password).

### `GET /api/auth/me`

Requires a token. Returns the logged-in user and their tenant.

**200**: `{ "user": { … }, "tenant": { … } }` (same fields as above).

Errors: `401 UNAUTHORIZED`, `401 TOKEN_EXPIRED`, `403 TENANT_INACTIVE`.

Passwords, password hashes and Shopify access tokens are never returned by any endpoint.

## Records

All require a token and only return the caller's own tenant's data. `:id` is the record's numeric
id. Money fields are decimal strings in INR without trailing zeros, e.g. `"998"` or `"499.5"`.

Errors for all three: `401 UNAUTHORIZED`, `401 TOKEN_EXPIRED`, `403 TENANT_INACTIVE`,
`404 NOT_FOUND` (missing id, invalid id, or another tenant's record).

### `GET /api/customers/:id`

**200**: `{ "customer": { "id": 3, "shopifyCustomerId": "…", "email": "…", "totalSpent": "…", … } }`

### `GET /api/products/:id`

**200**: `{ "product": { "id": 1, "shopifyProductId": "…", "title": "…", "price": "…", … } }`

### `GET /api/orders/:id`

Includes the order's line items.

**200**: `{ "order": { "id": 2, "shopifyOrderId": "…", "totalPrice": "…", "lineItems": [ … ], … } }`
