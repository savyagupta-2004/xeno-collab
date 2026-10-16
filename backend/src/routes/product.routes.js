const { Router } = require('express');
const productController = require('../controllers/product.controller');
const requireAuth = require('../middleware/requireAuth');

const router = Router();

router.use(requireAuth);
router.get('/:id', productController.getById);

module.exports = router;
