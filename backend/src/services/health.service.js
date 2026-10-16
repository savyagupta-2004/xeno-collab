// Uses the unscoped client on purpose: the health check only runs `SELECT 1`, no tenant data.
const { checkDatabaseConnection } = require('../config/prisma');

const getHealth = async () => {
  const dbUp = await checkDatabaseConnection();

  return {
    healthy: dbUp,
    body: {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    },
  };
};

module.exports = { getHealth };
