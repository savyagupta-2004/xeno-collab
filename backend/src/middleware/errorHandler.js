// Express recognises error handlers by their 4 arguments, so `_next` must stay.
const errorHandler = (err, req, res, _next) => {
  // Malformed JSON body sent to express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Invalid JSON body', code: 'INVALID_JSON' } });
  }

  const statusCode = err.statusCode || err.status || 500;
  const isServerError = statusCode >= 500;

  if (isServerError && process.env.NODE_ENV !== 'test') {
    console.error(err);
  }

  // Never leak internal error details to clients
  const message = isServerError ? 'Internal server error' : err.message;
  const code = isServerError ? 'INTERNAL_ERROR' : err.code || 'REQUEST_ERROR';

  return res.status(statusCode).json({ error: { message, code } });
};

module.exports = errorHandler;
