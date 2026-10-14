const { PrismaClient } = require('@prisma/client');

// One shared client for the whole app; Prisma manages the connection pool.
const prisma = new PrismaClient();

const DB_CHECK_TIMEOUT_MS = 3000;

// Resolves true if the database answers `SELECT 1` within the timeout, false otherwise.
const checkDatabaseConnection = async (timeoutMs = DB_CHECK_TIMEOUT_MS) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Database check timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error(`[db] Health check failed: ${err.message}`);
    }
    return false;
  } finally {
    clearTimeout(timer);
  }
};

module.exports = { prisma, checkDatabaseConnection };
