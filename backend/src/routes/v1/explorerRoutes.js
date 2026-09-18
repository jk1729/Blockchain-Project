/**
 * PDSChain v1 Explorer Routes (Phase 15)
 */

const express = require('express');
const router = express.Router();
const explorerController = require('../../controllers/explorerController');

// GET /api/v1/explorer/overview
router.get('/overview', (req, res, next) => explorerController.getOverview(req, res, next));

// GET /api/v1/explorer/search?q=...
router.get('/search', (req, res, next) => explorerController.search(req, res, next));

// GET /api/v1/explorer/address/:address
router.get('/address/:address', (req, res, next) => explorerController.getAddressDetails(req, res, next));

// GET /api/v1/explorer/block/:identifier
router.get('/block/:identifier', (req, res, next) => explorerController.getBlockDetails(req, res, next));

module.exports = router;

