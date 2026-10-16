const { Router } = require('express');
const orderController = require('../controllers/order.controller');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

router.use(requireAuth);
router.get('/:id', orderController.getById);

module.exports = router;
