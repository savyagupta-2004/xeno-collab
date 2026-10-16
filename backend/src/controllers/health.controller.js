const healthService = require('../services/health.service');

const getHealth = async (req, res) => {
  const { healthy, body } = await healthService.getHealth();
  res.status(healthy ? 200 : 503).json(body);
};

module.exports = { getHealth };
