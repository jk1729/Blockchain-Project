const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');

router.get('/status', ledgerController.getStatus);
router.get('/checkpoint', ledgerController.getCheckpoint);

module.exports = router;

