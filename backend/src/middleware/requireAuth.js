const AppError = require('../utils/AppError');
const { verifyToken } = require('../utils/jwt');

// Accepts `Authorization: Bearer <jwt>` and sets req.auth = { userId, tenantId }.
// Every tenant-scoped query must use req.auth.tenantId.
const requireAuth = (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  try {
    const { userId, tenantId } = verifyToken(token);
    if (!userId || !tenantId) throw new Error('Token is missing claims');
    req.auth = { userId, tenantId };
    return next();
  } catch {
    return next(new AppError('Invalid or expired token', 401, 'UNAUTHORIZED'));
  }
};

module.exports = requireAuth;
