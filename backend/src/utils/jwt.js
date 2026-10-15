const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const { JWT_ALGORITHM, JWT_EXPIRES_IN } = require('../config/auth');

const signToken = ({ userId, tenantId }) =>
  jwt.sign({ userId, tenantId }, jwtSecret, {
    algorithm: JWT_ALGORITHM,
    expiresIn: JWT_EXPIRES_IN,
  });

// Throws if the token is missing, tampered with or expired.
const verifyToken = (token) => jwt.verify(token, jwtSecret, { algorithms: [JWT_ALGORITHM] });

module.exports = { signToken, verifyToken };
