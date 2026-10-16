const { forTenant } = require('./tenantDb');
const parseRecordId = require('../utils/parseRecordId');
const recordNotFound = require('../utils/recordNotFound');

const getOrderById = async (tenantId, rawId) => {
  const id = parseRecordId(rawId);
  const order =
    id &&
    (await forTenant(tenantId).order.findUnique({
      where: { id },
      include: { lineItems: { orderBy: { id: 'asc' } } },
    }));
  if (!order) throw recordNotFound('Order');
  return order;
};

module.exports = { getOrderById };
