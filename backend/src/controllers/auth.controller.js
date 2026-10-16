const authService = require('../services/auth.service');

const register = async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
};

const login = async (req, res) => {
  const result = await authService.login(req.body);
  res.status(200).json(result);
};

const me = async (req, res) => {
  const profile = await authService.getProfile({ userId: req.user.id, tenantId: req.tenantId });
  res.status(200).json(profile);
};

module.exports = { register, login, me };
