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

Public. Liveness check.

**200**

```json
{ "status": "ok", "timestamp": "2026-10-13T12:00:00.000Z" }
```
