const productService = require('../services/product.service');

const getById = async (req, res) => {
  const product = await productService.getProductById(req.tenantId, req.params.id);
  res.status(200).json({ product });
};

module.exports = { getById };
