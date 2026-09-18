/**
 * PDSChain v1 Event Routes (Phases 14 & 17 Hardening)
 */

const express = require('express');
const router = express.Router();
const eventController = require('../../controllers/eventController');
const { sendSuccess, sendError } = require('../../api/ResponseEnvelope');
const { optionalAuthMiddleware } = require('../../middleware/authMiddleware');

// Stream (SSE) with optional authentication
router.get('/stream', optionalAuthMiddleware, eventController.streamEvents);

// Metrics
router.get('/metrics', eventController.getMetricsHandler);

// Query events with standard envelope
router.get('/', (req, res) => {
  try {
    const store = (req.app && req.app.locals && req.app.locals.eventStore) || eventController.getStore(req);
    const result = store.query(req.query || {});
    return sendSuccess(res, result.events, {
      pagination: {
        total: result.total,
        limit: result.limit,
        cursor: result.cursor,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      }
    });
  } catch (err) {
    return sendError(res, 'EVENT_QUERY_ERROR', err.message, null, 400);
  }
});

// Single event by ID
router.get('/:eventId', (req, res) => {
  const store = (req.app && req.app.locals && req.app.locals.eventStore) || eventController.getStore(req);
  const event = store.getEventById(req.params.eventId);
  if (!event) {
    return sendError(res, 'EVENT_NOT_FOUND', `Event '${req.params.eventId}' not found.`, null, 404);
  }
  return sendSuccess(res, event.toJSON ? event.toJSON() : event);
});

module.exports = router;
