const { ForbiddenError, UnauthorizedError } = require('../utils/errors');
const { defaultAuthorizationService } = require('../security/permissions');

function roleMiddleware(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    const userRole = (req.user.role || '').toUpperCase().trim();
    const normalizedAllowed = allowedRoles.map(r => r.toUpperCase().trim());

    // Strict check: Caller role must be explicitly in allowedRoles.
    // In Phase 17, blanket 'userRole !== "ADMIN"' bypass is strictly prohibited.
    if (!normalizedAllowed.includes(userRole)) {
      // Check if user has active break-glass session
      const actorId = String(req.user.username || req.user.id || '');
      if (defaultAuthorizationService && defaultAuthorizationService.isBreakGlassActive(actorId)) {
        return next();
      }

      return next(new ForbiddenError(`Access forbidden: requires one of roles [${allowedRoles.join(', ')}]`));
    }

    next();
  };
}

module.exports = roleMiddleware;
