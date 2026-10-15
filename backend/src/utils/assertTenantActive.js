const AppError = require('./AppError');

// A deactivated store keeps its data but can't log in or call any protected API.
const assertTenantActive = (tenant) => {
  if (!tenant?.isActive) {
    throw new AppError('This store has been deactivated', 403, 'TENANT_INACTIVE');
  }
};

module.exports = assertTenantActive;
