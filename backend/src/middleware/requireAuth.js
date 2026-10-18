const AppError = require('../utils/AppError');
const assertTenantActive = require('../utils/assertTenantActive');
const { verifyToken } = require('../utils/jwt');
const { forTenant } = require('../services/tenantDb');

// Exactly "Bearer <header>.<payload>.<signature>". The scheme name is case-insensitive
// (RFC 7235), but nothing else is accepted: no other scheme, no extra parts.
const BEARER_HEADER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value) => typeof value === 'string' && UUID.test(value);
const invalidToken = () => new AppError('Invalid token', 401, 'UNAUTHORIZED');

// Verifies `Authorization: Bearer <jwt>` and sets:
//   req.user     = { id, tenantId, name, email }
//   req.tenantId = the caller's tenant; services pass it to forTenant() for every query
const requireAuth = async (req, res, next) => {
  const match = BEARER_HEADER.exec(req.headers.authorization || '');
  if (!match) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  let claims;
  try {
    claims = verifyToken(match[1]);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Token has expired', 401, 'TOKEN_EXPIRED');
    }
    throw invalidToken();
  }

  // Validate claim types before they reach the database, so a signed token with
  // malformed claims is a 401, never a Prisma error (500).
  const { userId, tenantId } = claims;
  if (!isUuid(userId) || !isUuid(tenantId)) throw invalidToken();

  // A JWT can't be revoked, so look the user up on every request (one primary-key lookup,
  // scoped to the token's tenant): deleting the user or store, or deactivating the store,
  // locks out existing tokens immediately instead of when they expire up to 24h later.
  const user = await forTenant(tenantId).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      tenantId: true,
      name: true,
      email: true,
      tenant: { select: { isActive: true } },
    },
  });
  if (!user) throw invalidToken();
  assertTenantActive(user.tenant);

  req.user = { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email };
  req.tenantId = tenantId;
  next();
};

module.exports = requireAuth;
