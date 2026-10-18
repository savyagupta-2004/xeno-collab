const { Router } = require('express');
const customerController = require('../controllers/customer.controller');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

router.use(requireAuth);
router.get('/:id', customerController.getById);

module.exports = router;
