# API Reference

Base URL (local): `http://localhost:5000/api`

## Error format

Every error response has this shape:

```json
{ "error": { "message": "Human readable message", "code": "MACHINE_CODE" } }
```

| Status | Code             | When                                                         |
| ------ | ---------------- | ------------------------------------------------------------ |
| 400    | `INVALID_JSON`   | Request body is not valid JSON                               |
| 404    | `NOT_FOUND`      | Route does not exist                                         |
| 500    | `INTERNAL_ERROR` | Unexpected server error (details are logged, never returned) |

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
