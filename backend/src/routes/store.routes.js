const { Router } = require('express');
const storeController = require('../controllers/store.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const { connectStoreSchema } = require('../validators/store.validators');

const router = Router();

router.use(requireAuth);
router.post('/connect', validate(connectStoreSchema), storeController.connect);
router.get('/status', storeController.status);

module.exports = router;
