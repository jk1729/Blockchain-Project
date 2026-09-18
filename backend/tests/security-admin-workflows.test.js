/**
 * Phase 17 Test Suite 7: Administrative Workflows & Lifecycle Operations
 */

const {
  AdminWorkflowManager,
  AuthorizationService,
  SecurityAuditLogger
} = require('../src/security/permissions');

describe('Phase 17: Administrative Workflows & Security Lifecycle Operations', () => {
  let adminManager;
  let auditLogger;
  let adminUser;
  let unauthorizedUser;

  beforeEach(() => {
    auditLogger = new SecurityAuditLogger({ inMemoryOnly: true });
    const authService = new AuthorizationService({ auditLogger });
    adminManager = new AdminWorkflowManager({ authService, auditLogger });

    adminUser = { id: 1, username: 'admin_master', role: 'ADMIN' };
    unauthorizedUser = { id: 2, username: 'citizen_bob', role: 'CITIZEN' };
  });

  describe('1. User Suspension & Role Workflows', () => {
    test('admin should be able to suspend and unsuspend a user', async () => {
      const res = await adminManager.suspendUser(adminUser, 'citizen_123', 'Investigating suspicious transactions');
      expect(res.status).toBe('SUSPENDED');
      expect(adminManager.isUserSuspended('citizen_123')).toBe(true);

      const unRes = await adminManager.unsuspendUser(adminUser, 'citizen_123', 'Cleared after investigation');
      expect(unRes.status).toBe('ACTIVE');
      expect(adminManager.isUserSuspended('citizen_123')).toBe(false);
    });

    test('unauthorized citizen should be rejected from suspending users', async () => {
      await expect(adminManager.suspendUser(unauthorizedUser, 'target_user')).rejects.toThrow();
    });

    test('super admin should be able to assign valid canonical role to user', async () => {
      const superAdminUser = { id: 99, username: 'super_admin', role: 'SUPER_ADMIN' };
      const res = await adminManager.assignRole(superAdminUser, 'operator_user', 'VALIDATOR_OPERATOR');
      expect(res.success).toBe(true);
      expect(res.role).toBe('VALIDATOR_OPERATOR');

      // Separation of duties: Standard admin without admin:manage:roles cannot assign roles
      await expect(adminManager.assignRole(adminUser, 'operator_user', 'VALIDATOR_OPERATOR')).rejects.toThrow();
    });

    test('should reject assigning non-existent role', async () => {
      const superAdminUser = { id: 99, username: 'super_admin', role: 'SUPER_ADMIN' };
      await expect(adminManager.assignRole(superAdminUser, 'operator_user', 'GOD_MODE')).rejects.toThrow(/does not exist/);
    });
  });

  describe('2. API Key Lifecycle Workflows', () => {
    test('admin should create, validate, rotate, and revoke API keys', () => {
      // 1. Create
      const keyData = adminManager.createApiKey(adminUser, { name: 'Client App', role: 'CLIENT' });
      expect(keyData.keyId).toBeDefined();
      expect(keyData.apiKey).toContain(keyData.keyId);

      // 2. Validate
      const valid = adminManager.validateApiKey(keyData.apiKey);
      expect(valid).toBeDefined();
      expect(valid.role).toBe('CLIENT');

      // 3. Rotate
      const rotated = adminManager.rotateApiKey(adminUser, keyData.keyId);
      expect(rotated.apiKey).not.toBe(keyData.apiKey);

      // Old key should fail validation
      expect(adminManager.validateApiKey(keyData.apiKey)).toBeNull();

      // New key should succeed
      expect(adminManager.validateApiKey(rotated.apiKey)).toBeDefined();

      // 4. Revoke
      adminManager.revokeApiKey(adminUser, keyData.keyId, 'Client decommissioned');
      expect(adminManager.validateApiKey(rotated.apiKey)).toBeNull();
    });
  });

  describe('3. Peer Authorization & Management Workflows', () => {
    test('security operator or admin should authorize, suspend, and revoke peers', () => {
      // Authorize
      const authRes = adminManager.authorizePeer(adminUser, 'VAL-99', { endpoint: '10.0.0.99:5001' });
      expect(authRes.status).toBe('AUTHORIZED');

      // Suspend
      const suspRes = adminManager.suspendPeer(adminUser, 'VAL-99', 'Temporary node maintenance');
      expect(suspRes.status).toBe('SUSPENDED');

      // Revoke
      const revRes = adminManager.revokePeer(adminUser, 'VAL-99', 'Compromised node');
      expect(revRes.status).toBe('REVOKED');
    });
  });

  describe('4. Backup & Maintenance Workflows', () => {
    test('admin should create and restore backup records', () => {
      const bakRes = adminManager.createBackup(adminUser);
      expect(bakRes.backupId).toBeDefined();

      const superAdminUser = { id: 9, username: 'super_admin', role: 'SUPER_ADMIN' };
      const restRes = adminManager.restoreBackup(superAdminUser, bakRes.backupId);
      expect(restRes.restored).toBe(true);
    });

    test('operator should trigger synchronization check', () => {
      const syncRes = adminManager.triggerSync(adminUser);
      expect(syncRes.success).toBe(true);
    });
  });
});
