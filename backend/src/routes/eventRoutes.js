/**
 * PDSChain Event Routes (Phase 13 & Phase 17 Hardening)
 */

const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { optionalAuthMiddleware } = require('../middleware/authMiddleware');

// Real-time Server-Sent Events stream (authenticated / public)
router.get('/stream', optionalAuthMiddleware, eventController.streamEvents);

// Event telemetry & Prometheus metrics
router.get('/metrics', eventController.getMetricsHandler);

// Query events by block (height or hash)
router.get('/blocks/:heightOrHash', eventController.getBlockEvents);

// Query events by transaction hash
router.get('/transactions/:txHash', eventController.getTransactionEvents);

// Query events by contract address
router.get('/contracts/:address', eventController.getContractEvents);

// Query events with filters and pagination
router.get('/', eventController.getEvents);

// Query by specific eventId
router.get('/:eventId', eventController.getEventById);

module.exports = router;
