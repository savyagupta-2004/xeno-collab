const customerService = require('../services/customer.service');

const getById = async (req, res) => {
  const customer = await customerService.getCustomerById(req.tenantId, req.params.id);
  res.status(200).json({ customer });
};

module.exports = { getById };
