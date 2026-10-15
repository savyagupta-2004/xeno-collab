const bcrypt = require('bcryptjs');
const { prisma } = require('../config/prisma');
const { BCRYPT_SALT_ROUNDS } = require('../config/auth');
const AppError = require('../utils/AppError');
const { signToken } = require('../utils/jwt');

// Only these columns ever leave the API. password_hash and shopify_access_token never do.
const USER_FIELDS = { id: true, tenantId: true, name: true, email: true, createdAt: true };
const TENANT_FIELDS = {
  id: true,
  name: true,
  shopDomain: true,
  isActive: true,
  lastSyncedAt: true,
  createdAt: true,
};

// Compared against when the email doesn't exist, so a login for an unknown email
// takes as long as one for a real account (no timing hint about which emails exist).
const DUMMY_PASSWORD_HASH = '$2b$12$eiELUHpOB6XvPtVVj2HQWOvyqFeHRexQ7cLFnVavB2/wVFyLH4B/C';

const INVALID_CREDENTIALS = () =>
  new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');

const isUniqueViolation = (err) => err?.code === 'P2002';

const toProfile = ({ tenant, ...user }) => ({ user, tenant });

const register = async ({ name, email, password, storeName }) => {
  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  try {
    // Tenant and user are created together: if the user insert fails, the tenant is rolled back.
    const { user, tenant } = await prisma.$transaction(async (tx) => {
      const newTenant = await tx.tenant.create({
        data: { name: storeName },
        select: TENANT_FIELDS,
      });
      const newUser = await tx.user.create({
        data: { tenantId: newTenant.id, name, email, passwordHash },
        select: USER_FIELDS,
      });
      return { user: newUser, tenant: newTenant };
    });

    return { token: signToken({ userId: user.id, tenantId: tenant.id }), user, tenant };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');
    }
    throw err;
  }
};

const login = async ({ email, password }) => {
  const record = await prisma.user.findUnique({
    where: { email },
    select: { ...USER_FIELDS, passwordHash: true, tenant: { select: TENANT_FIELDS } },
  });

  const passwordMatches = await bcrypt.compare(
    password,
    record?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  if (!record || !passwordMatches) throw INVALID_CREDENTIALS();

  const { user, tenant } = toProfile(record);
  delete user.passwordHash;

  return { token: signToken({ userId: user.id, tenantId: tenant.id }), user, tenant };
};

const getProfile = async ({ userId, tenantId }) => {
  // Scoped by tenantId from the token, not just userId.
  const record = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { ...USER_FIELDS, tenant: { select: TENANT_FIELDS } },
  });

  if (!record) throw new AppError('Account no longer exists', 401, 'UNAUTHORIZED');

  return toProfile(record);
};

module.exports = { register, login, getProfile };
