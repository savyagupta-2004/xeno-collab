const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const routes = require('./routes');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');

// Builds the Express app without starting it, so tests can use it directly.
const createApp = ({ frontendUrl = 'http://localhost:3000', nodeEnv = 'development' } = {}) => {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: frontendUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (nodeEnv !== 'test') {
    app.use(morgan(nodeEnv === 'production' ? 'combined' : 'dev'));
  }

  app.use('/api', routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};

module.exports = createApp;
