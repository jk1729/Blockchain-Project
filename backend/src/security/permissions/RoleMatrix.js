/**
 * PDSChain Canonical Role-Permission Matrix (Phase 17)
 * 
 * Formal mapping of system roles to explicit permission sets.
 * Non-Negotiable Invariants:
 * - NO wildcards or blanket shortcuts.
 * - Least privilege principle enforced.
 * - Separation of duties: public readers, clients, validators, operators, admins, recovery, and security roles.
 * - Super admin does NOT have raw private key export permissions.
 */

const { PermissionRegistry } = require('./PermissionRegistry');

// 1. Base Public Reader Permissions (inherited by all authenticated roles)
const PUBLIC_PERMISSIONS = Object.freeze(PermissionRegistry.getPublicPermissions());

// 2. Client Permissions (Standard Authenticated User)
const CLIENT_BASE = Object.freeze([
  ...PUBLIC_PERMISSIONS,
  'client:read:transaction-status',
  'client:read:receipt',
  'client:read:event',
  'client:read:proof',
  'client:read:account',
  'client:subscribe:event'
]);

// 3. Citizen (PDS Beneficiary Client)
const CITIZEN_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE
]);

// 4. Shop Officer (Fair Price Shop Operator)
const SHOP_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'client:submit:transaction',
  'client:execute:readonly-call',
  'client:estimate:gas',
  'pds:distribute:rations'
]);

// 5. Warehouse Manager (Commodity Depot Operator)
const WAREHOUSE_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'client:submit:transaction',
  'client:execute:readonly-call',
  'client:estimate:gas',
  'pds:transfer:stock'
]);

// 6. Developer / API Client
const DEVELOPER_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'client:submit:transaction',
  'client:execute:readonly-call',
  'client:estimate:gas'
]);

// 7. Auditor (External / Regulatory Read-Only Access)
const AUDITOR_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'operator:read:node-status',
  'operator:read:network-status',
  'operator:read:sync-status',
  'operator:read:recovery-status',
  'operator:read:security-events',
  'operator:read:audit-events',
  'operator:read:metrics',
  'security:read:tls-status',
  'security:read:certificate-metadata',
  'security:read:key-metadata',
  'recovery:read:status',
  'admin:read:audit-log'
]);

// 8. Validator (Consensus Daemon Process)
const VALIDATOR_PERMISSIONS = Object.freeze([
  ...PUBLIC_PERMISSIONS,
  'validator:authenticate:peer',
  'validator:read:peer-status',
  'validator:send:proposal',
  'validator:send:vote',
  'validator:send:certificate',
  'validator:send:round-change',
  'validator:request:sync',
  'validator:send:sync-response',
  'validator:read:consensus-state',
  'validator:read:finalized-ledger',
  'validator:write:consensus-journal',
  'validator:write:checkpoint',
  'validator:participate:consensus'
]);

// 9. Node / Validator Operator
const OPERATOR_BASE = Object.freeze([
  ...PUBLIC_PERMISSIONS,
  'operator:read:node-status',
  'operator:read:network-status',
  'operator:read:sync-status',
  'operator:read:recovery-status',
  'operator:read:security-events',
  'operator:read:audit-events',
  'operator:read:metrics',
  'operator:manage:validator-process',
  'operator:manage:peer',
  'operator:manage:configuration',
  'operator:manage:log-level',
  'operator:trigger:reindex',
  'operator:trigger:sync',
  'operator:trigger:backup',
  'security:read:tls-status',
  'security:read:certificate-metadata',
  'security:read:key-metadata',
  'recovery:read:status'
]);

const VALIDATOR_OPERATOR_PERMISSIONS = Object.freeze([
  ...OPERATOR_BASE
]);

const NODE_OPERATOR_PERMISSIONS = Object.freeze([
  ...OPERATOR_BASE
]);

const CONSORTIUM_OPERATOR_PERMISSIONS = Object.freeze([
  ...OPERATOR_BASE,
  'operator:restore:node',
  'operator:approve:recovery',
  'security:manage:peer-authorization'
]);

// 10. Security Operator (TLS, PKI, and Key Lifecycle Manager)
const SECURITY_OPERATOR_PERMISSIONS = Object.freeze([
  ...OPERATOR_BASE,
  'security:reload:certificate',
  'security:rotate:certificate',
  'security:revoke:certificate',
  'security:manage:trust-store',
  'security:manage:crl',
  'security:stage:key-rotation',
  'security:activate:key-rotation',
  'security:rollback:key-rotation',
  'security:revoke:identity',
  'security:manage:peer-authorization',
  'admin:read:audit-log'
]);

// 11. Recovery Operator (Disaster Recovery & Ledger Replay)
const RECOVERY_OPERATOR_PERMISSIONS = Object.freeze([
  ...OPERATOR_BASE,
  'recovery:verify:checkpoint',
  'recovery:replay:journal',
  'recovery:rebuild:index',
  'recovery:trigger:sync',
  'recovery:repair:derived-state',
  'recovery:rollback:nonfinalized-state',
  'recovery:halt:validator',
  'recovery:resume:validator',
  'recovery:restore:backup'
]);

// 12. Standard System Administrator (`ADMIN`)
const ADMIN_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'client:submit:transaction',
  'client:execute:readonly-call',
  'client:estimate:gas',
  ...OPERATOR_BASE,
  'admin:manage:users',
  'admin:manage:api-keys',
  'admin:manage:rate-limits',
  'admin:read:audit-log',
  'admin:manage:feature-flags',
  'pds:manage:shops',
  'pds:manage:warehouses',
  'pds:manage:beneficiaries',
  'pds:distribute:rations',
  'pds:transfer:stock',
  'security:manage:peer-authorization'
]);

// 13. API Admin
const API_ADMIN_PERMISSIONS = Object.freeze([
  ...CLIENT_BASE,
  'admin:manage:api-keys',
  'admin:manage:rate-limits',
  'admin:read:audit-log'
]);

// 14. System Admin
const SYSTEM_ADMIN_PERMISSIONS = Object.freeze([
  ...ADMIN_PERMISSIONS,
  'admin:manage:roles',
  'admin:manage:permissions',
  'admin:manage:service-accounts',
  'admin:export:audit-log',
  'admin:manage:network-policy'
]);

// 15. Super Admin (Governance Root - explicitly barred from raw private key export)
const SUPER_ADMIN_PERMISSIONS = Object.freeze([
  ...SYSTEM_ADMIN_PERMISSIONS,
  ...SECURITY_OPERATOR_PERMISSIONS,
  ...RECOVERY_OPERATOR_PERMISSIONS
]);

// 16. Break-Glass Operator (Emergency incident role, time-bound & audited)
const BREAK_GLASS_OPERATOR_PERMISSIONS = Object.freeze([
  ...SUPER_ADMIN_PERMISSIONS,
  'recovery:halt:validator',
  'recovery:resume:validator',
  'recovery:repair:derived-state',
  'security:destroy:key-material'
]);

const RoleDefinitions = Object.freeze({
  PUBLIC_READER: PUBLIC_PERMISSIONS,
  CLIENT: CLIENT_BASE,
  CITIZEN: CITIZEN_PERMISSIONS,
  SHOP: SHOP_PERMISSIONS,
  WAREHOUSE: WAREHOUSE_PERMISSIONS,
  DEVELOPER: DEVELOPER_PERMISSIONS,
  AUDITOR: AUDITOR_PERMISSIONS,
  VALIDATOR: VALIDATOR_PERMISSIONS,
  VALIDATOR_OPERATOR: VALIDATOR_OPERATOR_PERMISSIONS,
  NODE_OPERATOR: NODE_OPERATOR_PERMISSIONS,
  CONSORTIUM_OPERATOR: CONSORTIUM_OPERATOR_PERMISSIONS,
  SECURITY_OPERATOR: SECURITY_OPERATOR_PERMISSIONS,
  RECOVERY_OPERATOR: RECOVERY_OPERATOR_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
  API_ADMIN: API_ADMIN_PERMISSIONS,
  SYSTEM_ADMIN: SYSTEM_ADMIN_PERMISSIONS,
  SUPER_ADMIN: SUPER_ADMIN_PERMISSIONS,
  BREAK_GLASS_OPERATOR: BREAK_GLASS_OPERATOR_PERMISSIONS
});

class RoleMatrix {
  static getPermissionsForRole(roleName) {
    if (!roleName || typeof roleName !== 'string') return [];
    const normalized = roleName.trim().toUpperCase();
    return RoleDefinitions[normalized] ? [...RoleDefinitions[normalized]] : [];
  }

  static hasPermission(roleName, permissionId) {
    if (!roleName || !permissionId) return false;
    const permissions = RoleDefinitions[String(roleName).trim().toUpperCase()];
    if (!permissions) return false;
    return permissions.includes(String(permissionId).trim());
  }

  static isValidRole(roleName) {
    if (!roleName || typeof roleName !== 'string') return false;
    return Object.prototype.hasOwnProperty.call(RoleDefinitions, roleName.trim().toUpperCase());
  }

  static getAllRoles() {
    return Object.keys(RoleDefinitions);
  }

  static getRoleDefinitions() {
    return { ...RoleDefinitions };
  }
}

module.exports = {
  RoleDefinitions,
  RoleMatrix
};

