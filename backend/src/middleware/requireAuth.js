const { prisma } = require('../config/prisma');
const AppError = require('../utils/AppError');
const assertTenantActive = require('../utils/assertTenantActive');
const { verifyToken } = require('../utils/jwt');

const invalidToken = () => new AppError('Invalid or expired token', 401, 'UNAUTHORIZED');

// Accepts `Authorization: Bearer <jwt>` and sets req.auth = { userId, tenantId }.
// Every tenant-scoped query must use req.auth.tenantId.
const requireAuth = async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }

  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    throw invalidToken();
  }

  const { userId, tenantId } = claims;
  if (!userId || !tenantId) throw invalidToken();

  // A JWT can't be revoked, so check the tenant on every request (one primary-key lookup):
  // deleting or deactivating a store locks out its existing tokens immediately,
  // instead of when they expire up to 24h later.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { isActive: true },
  });
  if (!tenant) throw invalidToken();
  assertTenantActive(tenant);

  req.auth = { userId, tenantId };
  next();
};

module.exports = requireAuth;
