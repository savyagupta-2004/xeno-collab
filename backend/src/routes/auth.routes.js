const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const { loginSchema, registerSchema } = require('../validators/auth.validators');

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
