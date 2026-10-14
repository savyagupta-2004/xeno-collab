const config = require('./config/env');
const { prisma } = require('./config/prisma');
const createApp = require('./app');

const app = createApp({ frontendUrl: config.frontendUrl, nodeEnv: config.nodeEnv });

const server = app.listen(config.port, () => {
  console.log(`[server] Listening on http://localhost:${config.port} (${config.nodeEnv})`);
});

const shutdown = (signal) => {
  console.log(`[server] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
