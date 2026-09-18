/**
 * PDSChain JSON-RPC 2.0 Express Middleware (Phase 14 & Phase 17 Hardening)
 */

const jwt = require('jsonwebtoken');
const config = require('../config/env');
const User = require('../models/User');
const { defaultEngine } = require('./JsonRpcEngine');
const { RPC_ERRORS, createErrorResponse } = require('./JsonRpcErrors');
const { defaultAuthorizationService } = require('../security/permissions');

async function resolveUserFromRequest(req) {
  if (req.user) return req.user;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      const user = await User.findByPk(decoded.id);
      if (user) {
        return {
          id: user.id,
          username: user.username,
          role: user.role,
          name: user.name,
          entityId: user.entityId
        };
      }
    } catch (e) {
      // Invalid/expired token
    }
  }
  return null;
}

function createRpcMiddleware(engine = defaultEngine) {
  return async (req, res, next) => {
    // Only accept POST
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json(createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'JSON-RPC only supports HTTP POST'));
    }

    // Check Content-Type
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('application/json')) {
      return res.status(415).json(createErrorResponse(null, RPC_ERRORS.INVALID_REQUEST, 'Content-Type must be application/json'));
    }

    const body = req.body;
    if (!body || (typeof body !== 'object' && !Array.isArray(body))) {
      return res.status(400).json(createErrorResponse(null, RPC_ERRORS.PARSE_ERROR));
    }

    // Resolve authenticated user if token present
    const user = await resolveUserFromRequest(req);
    if (user) {
      req.user = user;
    }

    // Build context
    const context = {
      req,
      user,
      authService: defaultAuthorizationService,
      peerManager: req.app && req.app.locals && req.app.locals.peerManager,
      eventStore: req.app && req.app.locals && req.app.locals.eventStore,
      metrics: req.app && req.app.locals && req.app.locals.eventMetrics
    };

    try {
      const response = await engine.handle(body, context);

      res.setHeader('Content-Type', 'application/json');
      if (response === null) {
        // All were notifications
        return res.status(204).end();
      }

      return res.status(200).json(response);
    } catch (err) {
      return res.status(500).json(createErrorResponse(null, RPC_ERRORS.INTERNAL_ERROR, err.message));
    }
  };
}

module.exports = {
  createRpcMiddleware,
  rpcMiddleware: createRpcMiddleware(defaultEngine)
};
