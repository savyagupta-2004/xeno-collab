const AppError = require('./AppError');

// Same 404 whether the record doesn't exist or belongs to another tenant,
// so a caller can't tell whether an id is in use elsewhere.
const recordNotFound = (label) => new AppError(`${label} not found`, 404, 'NOT_FOUND');

module.exports = recordNotFound;
