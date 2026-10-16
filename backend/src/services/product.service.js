const { forTenant } = require('./tenantDb');
const parseRecordId = require('../utils/parseRecordId');
const recordNotFound = require('../utils/recordNotFound');

const getProductById = async (tenantId, rawId) => {
  const id = parseRecordId(rawId);
  const product = id && (await forTenant(tenantId).product.findUnique({ where: { id } }));
  if (!product) throw recordNotFound('Product');
  return product;
};

module.exports = { getProductById };
