const orderService = require('../services/order.service');

const getById = async (req, res) => {
  const order = await orderService.getOrderById(req.tenantId, req.params.id);
  res.status(200).json({ order });
};

module.exports = { getById };
