/**
 * PDSChain Declarative Permission Middleware (Phase 17)
 * 
 * Express middleware for declarative route access control.
 * Features:
 * - Direct integration with central AuthorizationService.
 * - Automatic object-level ownership & scope parameter extraction.
 * - Proper HTTP status code mapping (401 Unauthorized vs 403 Forbidden).
 * - Tamper-evident audit logging of all authorization attempts.
 */

const { defaultAuthorizationService } = require('./AuthorizationService');
const { UnauthorizedError, ForbiddenError } = require('../../utils/errors');

/**
 * Creates an Express middleware enforcing a required permission.
 * 
 * @param {string} permissionId - Canonical permission identifier from PermissionRegistry
 * @param {object} [options]
 * @param {function} [options.extractEntityId] - Custom extractor for target entity ID
 * @param {function} [options.extractUserId] - Custom extractor for target user ID
 * @param {function} [options.extractValidatorId] - Custom extractor for target validator ID
 * @param {AuthorizationService} [options.authService]
 */
function requirePermission(permissionId, options = {}) {
  const authService = options.authService || defaultAuthorizationService;

  return (req, res, next) => {
    const user = req.user || null;

    // Extract contextual IDs for object-level ownership (IDOR/BOLA prevention)
    let targetEntityId = null;
    if (typeof options.extractEntityId === 'function') {
      targetEntityId = options.extractEntityId(req);
    } else {
      targetEntityId = req.params.shopId || req.params.warehouseId || req.query.shopId || (req.body && (req.body.shopId || req.body.warehouseId)) || null;
    }

    let targetUserId = null;
    if (typeof options.extractUserId === 'function') {
      targetUserId = options.extractUserId(req);
    } else {
      targetUserId = req.params.userId || req.query.userId || (req.body && req.body.userId) || null;
    }

    let targetValidatorId = null;
    if (typeof options.extractValidatorId === 'function') {
      targetValidatorId = options.extractValidatorId(req);
    } else {
      targetValidatorId = req.params.validatorId || req.params.id || null;
    }

    const context = {
      targetEntityId,
      targetUserId,
      targetValidatorId,
      requestId: req.requestId || req.headers['x-request-id'] || null,
      correlationId: req.correlationId || req.headers['x-correlation-id'] || null,
      method: req.method,
      path: req.originalUrl || req.path
    };

    const evaluation = authService.evaluate({ user, permissionId, context });

    if (evaluation.allowed) {
      req.permissionEvaluated = permissionId;
      return next();
    }

    // Distinguish 401 Unauthorized (missing authentication) from 403 Forbidden (insufficient permissions)
    if (!user && evaluation.permissionDef && !evaluation.permissionDef.isPublic) {
      return next(new UnauthorizedError(evaluation.reason || 'Authentication required to access this resource'));
    }

    return next(new ForbiddenError(evaluation.reason || `Access denied for permission '${permissionId}'`));
  };
}

module.exports = {
  requirePermission
};

