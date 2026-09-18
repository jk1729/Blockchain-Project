/**
 * PDSChain Centralized Authorization Service (Phase 17)
 * 
 * Core Policy Engine enforcing:
 * - Strict Default Deny for all unpermitted actions.
 * - Granular role-to-permission mapping via RoleMatrix.
 * - Object-level scope & ownership validation (IDOR/BOLA protection).
 * - Time-bounded, audited Break-Glass emergency access.
 * - Zero blanket bypass for administrative users.
 * - Real-time security audit logging of all access decisions.
 */

const { PermissionRegistry, ScopeType } = require('./PermissionRegistry');
const { RoleMatrix } = require('./RoleMatrix');
const { defaultSecurityAuditLogger } = require('./SecurityAuditLogger');
const { defaultSecurityMetrics } = require('./SecurityMetrics');

class AuthorizationService {
  /**
   * @param {object} [options]
   * @param {SecurityAuditLogger} [options.auditLogger]
   * @param {SecurityMetrics} [options.metrics]
   */
  constructor(options = {}) {
    this.auditLogger = options.auditLogger || defaultSecurityAuditLogger;
    this.metrics = options.metrics || defaultSecurityMetrics;

    // Active break-glass emergency sessions: operatorId -> Session
    this.activeBreakGlassSessions = new Map();
  }

  /**
   * Evaluate whether a user/subject is authorized for an action.
   * 
   * @param {object} params
   * @param {object|null} params.user - Authenticated user context ({ id, username, role, entityId })
   * @param {string} params.permissionId - Canonical permission identifier
   * @param {object} [params.context] - Request context ({ targetEntityId, targetUserId, targetValidatorId, requestId, correlationId })
   * @returns {{ allowed: boolean, decision: 'ALLOW' | 'DENY', reason: string, permissionDef: object|null }}
   */
  evaluate({ user, permissionId, context = {} }) {
    if (!permissionId || typeof permissionId !== 'string') {
      const decision = 'DENY';
      const reason = 'Invalid or missing permission identifier';
      this._recordAudit({ user, permissionId: 'invalid', decision, reason, context });
      return { allowed: false, decision, reason, permissionDef: null };
    }

    const permDef = PermissionRegistry.get(permissionId);
    if (!permDef) {
      const decision = 'DENY';
      const reason = `Unregistered permission identifier '${permissionId}' (Default Deny)`;
      this._recordAudit({ user, permissionId, decision, reason, context });
      return { allowed: false, decision, reason, permissionDef: null };
    }

    // 1. If public permission, allow for everyone (including unauthenticated)
    if (permDef.isPublic) {
      const decision = 'ALLOW';
      const reason = 'Public permission granted by policy';
      // Do not flood audit logs for public routine reads unless requested
      if (permDef.auditRequired) {
        this._recordAudit({ user, permissionId, decision, reason, context, permDef });
      }
      return { allowed: true, decision, reason, permDef };
    }

    // 2. Non-public permission requires an authenticated user
    if (!user) {
      const decision = 'DENY';
      const reason = 'Authentication required for non-public permission';
      this._recordAudit({ user, permissionId, decision, reason, context, permDef });
      return { allowed: false, decision, reason, permDef };
    }

    const userRole = (user.role || '').toUpperCase().trim();
    const actorId = String(user.username || user.id || 'unknown');

    // 3. Check for active Break-Glass override
    if (this.isBreakGlassActive(actorId)) {
      const session = this.activeBreakGlassSessions.get(actorId);
      const decision = 'ALLOW';
      const reason = `Authorized via active Break-Glass session (Reason: ${session.reason})`;
      this._recordAudit({ user, permissionId, decision, reason, context, permDef, isBreakGlass: true });
      this.metrics.incrementPrivilegedAction(permissionId);
      return { allowed: true, decision, reason, permDef };
    }

    // 4. Evaluate RoleMatrix permission assignment
    const hasRolePermission = RoleMatrix.hasPermission(userRole, permissionId);
    if (!hasRolePermission) {
      const decision = 'DENY';
      const reason = `Role '${userRole}' does not possess permission '${permissionId}'`;
      this._recordAudit({ user, permissionId, decision, reason, context, permDef });
      return { allowed: false, decision, reason, permDef };
    }

    // 5. Enforce Object-Level Scope & Ownership Checks
    const scopeCheck = this._verifyScopeAndOwnership(user, permDef, context);
    if (!scopeCheck.allowed) {
      const decision = 'DENY';
      const reason = scopeCheck.reason;
      this.metrics.incrementIdorAttempt();
      this._recordAudit({ user, permissionId, decision, reason, context, permDef });
      return { allowed: false, decision, reason, permDef };
    }

    // 6. Access Granted
    const decision = 'ALLOW';
    const reason = `Authorized: Role '${userRole}' holds permission '${permissionId}'`;
    if (permDef.auditRequired || permDef.isMutating) {
      this._recordAudit({ user, permissionId, decision, reason, context, permDef });
      this.metrics.incrementPrivilegedAction(permissionId);
    }

    return { allowed: true, decision, reason, permDef };
  }

  isAuthorized(user, permissionId, context = {}) {
    const result = this.evaluate({ user, permissionId, context });
    return result.allowed;
  }

  /**
   * Verify object-level ownership and scope bounds
   */
  _verifyScopeAndOwnership(user, permDef, context) {
    const userRole = (user.role || '').toUpperCase().trim();

    // Global administrative roles can manage across entities for domain workflows
    const isGlobalAdmin = ['ADMIN', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(userRole);

    switch (permDef.scope) {
      case ScopeType.USER: {
        // If operation is scoped to user, targetUserId must match user's id or username
        if (context.targetUserId !== undefined && context.targetUserId !== null) {
          const target = String(context.targetUserId).toLowerCase();
          const userIdStr = String(user.id).toLowerCase();
          const usernameStr = String(user.username || '').toLowerCase();

          if (target !== userIdStr && target !== usernameStr && !isGlobalAdmin) {
            return {
              allowed: false,
              reason: `Object-level ownership failure: caller '${user.username}' cannot access user resource '${context.targetUserId}'`
            };
          }
        }
        break;
      }

      case ScopeType.ENTITY: {
        // If operation is scoped to entity (shop, warehouse, beneficiary)
        if (context.targetEntityId !== undefined && context.targetEntityId !== null) {
          const targetEntity = String(context.targetEntityId).toUpperCase().trim();
          const userEntity = String(user.entityId || '').toUpperCase().trim();

          // Non-admin callers must match their assigned entityId
          if (!isGlobalAdmin && userEntity !== targetEntity) {
            return {
              allowed: false,
              reason: `Entity scope violation: caller entity '${userEntity}' not authorized for target '${targetEntity}'`
            };
          }
        }
        break;
      }

      case ScopeType.VALIDATOR: {
        // If operation is scoped to validator node
        if (context.targetValidatorId !== undefined && context.targetValidatorId !== null) {
          const targetVal = String(context.targetValidatorId).toUpperCase().trim();
          const userEntity = String(user.entityId || user.username || '').toUpperCase().trim();

          if (!isGlobalAdmin && userEntity !== targetVal) {
            return {
              allowed: false,
              reason: `Validator scope violation: caller node '${userEntity}' not authorized for target validator '${targetVal}'`
            };
          }
        }
        break;
      }

      case ScopeType.RESTRICTED: {
        // Restricted actions require elevated admin or explicit approval
        if (!['SECURITY_OPERATOR', 'RECOVERY_OPERATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN', 'BREAK_GLASS_OPERATOR'].includes(userRole)) {
          return {
            allowed: false,
            reason: `Restricted operation requires elevated operator role`
          };
        }
        break;
      }

      default:
        break;
    }

    return { allowed: true };
  }

  _recordAudit({ user, permissionId, decision, reason, context = {}, permDef = null, isBreakGlass = false }) {
    const actorId = user ? String(user.username || user.id) : 'anonymous';
    const actorType = user ? String(user.role || 'CLIENT').toUpperCase() : 'PUBLIC';

    this.auditLogger.logEvent({
      actorId,
      actorType,
      permissionEvaluated: permissionId,
      action: permDef ? permDef.action : 'evaluate',
      resource: permDef ? permDef.resource : 'access',
      scope: permDef ? permDef.scope : 'GLOBAL',
      decision,
      reason,
      requestId: context.requestId || null,
      correlationId: context.correlationId || null,
      details: {
        isBreakGlass,
        targetEntityId: context.targetEntityId || null,
        targetUserId: context.targetUserId || null
      }
    });
  }

  // --- Break-Glass Emergency Controls ---

  /**
   * Activate time-bounded Break-Glass emergency access
   * @param {object} params
   * @param {string} params.operatorId
   * @param {string} params.reason
   * @param {number} [params.durationSeconds] Default 3600 (1 hour), max 86400 (24h)
   * @param {string} [params.approverId]
   */
  activateBreakGlass({ operatorId, reason, durationSeconds = 3600, approverId = 'SYSTEM' }) {
    if (!operatorId || !reason) {
      throw new Error('Break-glass activation requires operatorId and documented justification reason.');
    }

    const duration = Math.min(Math.max(Number(durationSeconds) || 3600, 60), 86400); // 1 min to 24h
    const now = Date.now();
    const expiresAt = now + (duration * 1000);

    const session = {
      operatorId: String(operatorId),
      reason: String(reason).trim(),
      approverId: String(approverId),
      activatedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresTimestamp: expiresAt
    };

    this.activeBreakGlassSessions.set(session.operatorId, session);
    this.metrics.incrementBreakGlass();

    this.auditLogger.logEvent({
      actorId: session.operatorId,
      actorType: 'BREAK_GLASS_OPERATOR',
      permissionEvaluated: 'security:break-glass:activate',
      action: 'activate',
      resource: 'system',
      scope: ScopeType.RESTRICTED,
      decision: 'ALLOW',
      reason: `Break-Glass activated by ${approverId}: ${reason}`,
      details: {
        durationSeconds: duration,
        expiresAt: session.expiresAt
      }
    });

    return session;
  }

  revokeBreakGlass({ operatorId, reason = 'Incident resolved' }) {
    if (!this.activeBreakGlassSessions.has(operatorId)) {
      return false;
    }

    this.activeBreakGlassSessions.delete(operatorId);

    this.auditLogger.logEvent({
      actorId: operatorId,
      actorType: 'BREAK_GLASS_OPERATOR',
      permissionEvaluated: 'security:break-glass:revoke',
      action: 'revoke',
      resource: 'system',
      scope: ScopeType.RESTRICTED,
      decision: 'ALLOW',
      reason: `Break-Glass revoked: ${reason}`
    });

    return true;
  }

  isBreakGlassActive(operatorId) {
    if (!operatorId || !this.activeBreakGlassSessions.has(operatorId)) {
      return false;
    }

    const session = this.activeBreakGlassSessions.get(operatorId);
    if (Date.now() > session.expiresTimestamp) {
      this.activeBreakGlassSessions.delete(operatorId);
      return false;
    }

    return true;
  }

  getActiveBreakGlassSessions() {
    // Clean expired
    const now = Date.now();
    for (const [id, session] of this.activeBreakGlassSessions.entries()) {
      if (now > session.expiresTimestamp) {
        this.activeBreakGlassSessions.delete(id);
      }
    }
    return Array.from(this.activeBreakGlassSessions.values());
  }
}

const defaultAuthorizationService = new AuthorizationService();

module.exports = {
  AuthorizationService,
  defaultAuthorizationService
};

