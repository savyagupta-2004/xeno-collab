const MAX_INT = 2147483647; // PostgreSQL INTEGER / SERIAL upper bound

// Turns a URL id like "42" into a number, or null if it can't be a valid row id.
const parseRecordId = (value) => {
  if (!/^\d{1,10}$/.test(String(value))) return null;
  const id = Number(value);
  return id >= 1 && id <= MAX_INT ? id : null;
};

module.exports = parseRecordId;
