const express = require('express');
const router = express.Router();
const networkController = require('../controllers/networkController');

router.get('/status', networkController.getStatus);
router.get('/peers', networkController.getPeers);
router.get('/topology', networkController.getTopology);
router.get('/metrics', networkController.getMetrics);
router.get('/sync/status', networkController.getSyncStatus);

module.exports = router;

