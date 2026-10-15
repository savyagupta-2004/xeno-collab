const AppError = require('../utils/AppError');

// Validates req.body against a zod schema. On success req.body is replaced with the
// parsed (trimmed, normalised) data; on failure responds 400 with one message per field.
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});

  if (!result.success) {
    const fields = {};
    for (const issue of result.error.issues) {
      const field = issue.path.join('.') || 'body';
      if (!fields[field]) fields[field] = issue.message;
    }
    return next(new AppError('Invalid request body', 400, 'VALIDATION_ERROR', fields));
  }

  req.body = result.data;
  return next();
};

module.exports = validate;
