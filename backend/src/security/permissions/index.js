/**
 * PDSChain Security Permissions Subsystem (Phase 17)
 */

const { ScopeType, PermissionDefinitions, PermissionRegistry } = require('./PermissionRegistry');
const { RoleDefinitions, RoleMatrix } = require('./RoleMatrix');
const { AuthorizationService, defaultAuthorizationService } = require('./AuthorizationService');
const { requirePermission } = require('./permissionMiddleware');
const { SecurityAuditLogger, defaultSecurityAuditLogger, sanitizeSecrets } = require('./SecurityAuditLogger');
const { SecurityMetrics, defaultSecurityMetrics } = require('./SecurityMetrics');
const { AdminWorkflowManager, defaultAdminWorkflowManager } = require('./AdminWorkflowManager');

module.exports = {
  ScopeType,
  PermissionDefinitions,
  PermissionRegistry,
  RoleDefinitions,
  RoleMatrix,
  AuthorizationService,
  defaultAuthorizationService,
  requirePermission,
  SecurityAuditLogger,
  defaultSecurityAuditLogger,
  sanitizeSecrets,
  SecurityMetrics,
  defaultSecurityMetrics,
  AdminWorkflowManager,
  defaultAdminWorkflowManager
};

