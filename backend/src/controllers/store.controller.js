const storeService = require('../services/store.service');

const connect = async (req, res) => {
  const result = await storeService.connectStore(req.tenantId, req.body);
  res.status(200).json(result);
};

const status = async (req, res) => {
  const store = await storeService.getStoreStatus(req.tenantId);
  res.status(200).json({ store });
};

module.exports = { connect, status };
