const { forTenant } = require('./tenantDb');
const parseRecordId = require('../utils/parseRecordId');
const recordNotFound = require('../utils/recordNotFound');

const getCustomerById = async (tenantId, rawId) => {
  const id = parseRecordId(rawId);
  const customer = id && (await forTenant(tenantId).customer.findUnique({ where: { id } }));
  if (!customer) throw recordNotFound('Customer');
  return customer;
};

module.exports = { getCustomerById };
