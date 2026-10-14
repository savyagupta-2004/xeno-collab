const { checkDatabaseConnection } = require('../config/prisma');

const getHealth = async (req, res) => {
  const dbUp = await checkDatabaseConnection();

  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    db: dbUp ? 'up' : 'down',
    timestamp: new Date().toISOString(),
  });
};

module.exports = { getHealth };
