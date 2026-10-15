# API Reference

Base URL (local): `http://localhost:5000/api`

## Authentication

Protected endpoints need the JWT from register/login in the `Authorization` header:

```
Authorization: Bearer <token>
```

The token is valid for 24 hours and carries `userId` and `tenantId`.

## Error format

Every error response has this shape:

```json
{ "error": { "message": "Human readable message", "code": "MACHINE_CODE" } }
```

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

| Status | Code                  | When                                                         |
| ------ | --------------------- | ------------------------------------------------------------ |
| 400    | `INVALID_JSON`        | Request body is not valid JSON                               |
| 400    | `VALIDATION_ERROR`    | Request body fails validation (see `fields`)                 |
| 401    | `UNAUTHORIZED`        | Missing, invalid or expired token                            |
| 401    | `INVALID_CREDENTIALS` | Wrong email or password (same message for both)              |
| 404    | `NOT_FOUND`           | Route does not exist                                         |
| 409    | `EMAIL_TAKEN`         | An account with this email already exists                    |
| 500    | `INTERNAL_ERROR`      | Unexpected server error (details are logged, never returned) |

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

Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`.

### `GET /api/auth/me`

Requires a token. Returns the logged-in user and their tenant.

**200**: `{ "user": { … }, "tenant": { … } }` (same fields as above).

Errors: `401 UNAUTHORIZED`.

Passwords, password hashes and Shopify access tokens are never returned by any endpoint.
