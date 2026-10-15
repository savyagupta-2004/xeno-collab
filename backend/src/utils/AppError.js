class AppError extends Error {
  // `fields` maps field names to messages for validation errors, e.g. { email: 'Enter a valid email' }
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', fields = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fields = fields;
  }
}

module.exports = AppError;
