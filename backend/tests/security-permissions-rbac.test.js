/**
 * Phase 17 Test Suite 1: Canonical Permissions, Role Matrix & Authorization Engine
 */

const {
  PermissionRegistry,
  RoleMatrix,
  AuthorizationService,
  ScopeType
} = require('../src/security/permissions');

describe('Phase 17: Canonical Permissions, Role Matrix & Authorization Engine', () => {
  let authService;

  beforeEach(() => {
    authService = new AuthorizationService();
  });

  describe('1. PermissionRegistry Invariants', () => {
    test('should have all standard public permissions registered', () => {
      const publicPerms = PermissionRegistry.getPublicPermissions();
      expect(publicPerms).toContain('public:read:chain');
      expect(publicPerms).toContain('public:read:block');
      expect(publicPerms).toContain('public:read:transaction');
      expect(publicPerms).toContain('public:read:receipt');
      expect(publicPerms).toContain('public:read:proof');
      expect(publicPerms).toContain('public:read:health');
    });

    test('should define metadata for registered permissions', () => {
      const blockPerm = PermissionRegistry.get('public:read:block');
      expect(blockPerm).toBeDefined();
      expect(blockPerm.resource).toBe('block');
      expect(blockPerm.action).toBe('read');
      expect(blockPerm.isPublic).toBe(true);
      expect(blockPerm.isMutating).toBe(false);

      const rotatePerm = PermissionRegistry.get('security:rotate:certificate');
      expect(rotatePerm).toBeDefined();
      expect(rotatePerm.isPublic).toBe(false);
      expect(rotatePerm.isMutating).toBe(true);
      expect(rotatePerm.requiresMFA).toBe(true);
    });

    test('should return null for unregistered permissions', () => {
      expect(PermissionRegistry.get('admin:hack:everything')).toBeNull();
      expect(PermissionRegistry.has('admin:hack:everything')).toBe(false);
    });
  });

  describe('2. RoleMatrix & Least Privilege', () => {
    test('no role should have wildcard permissions', () => {
      const allRoles = RoleMatrix.getAllRoles();
      for (const role of allRoles) {
        const perms = RoleMatrix.getPermissionsForRole(role);
        expect(perms).not.toContain('*');
        expect(perms).not.toContain('*:*:*');
      }
    });

    test('PUBLIC_READER should only have public read permissions', () => {
      const perms = RoleMatrix.getPermissionsForRole('PUBLIC_READER');
      for (const p of perms) {
        const def = PermissionRegistry.get(p);
        expect(def.isPublic).toBe(true);
        expect(def.isMutating).toBe(false);
      }
    });

    test('SUPER_ADMIN must NOT possess raw private key load/export permission', () => {
      const perms = RoleMatrix.getPermissionsForRole('SUPER_ADMIN');
      expect(perms).not.toContain('security:load:key');
    });

    test('VALIDATOR role should possess consensus permissions but not admin user management', () => {
      expect(RoleMatrix.hasPermission('VALIDATOR', 'validator:send:proposal')).toBe(true);
      expect(RoleMatrix.hasPermission('VALIDATOR', 'validator:send:vote')).toBe(true);
      expect(RoleMatrix.hasPermission('VALIDATOR', 'admin:manage:users')).toBe(false);
    });
  });

  describe('3. AuthorizationService Default-Deny & Evaluation', () => {
    test('should allow public permissions without authentication', () => {
      const res = authService.evaluate({
        user: null,
        permissionId: 'public:read:block'
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe('ALLOW');
    });

    test('should deny unauthenticated requests for non-public permissions', () => {
      const res = authService.evaluate({
        user: null,
        permissionId: 'client:submit:transaction'
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe('DENY');
      expect(res.reason).toContain('Authentication required');
    });

    test('should deny authenticated user if role lacks permission (Default Deny)', () => {
      const citizenUser = { id: 1, username: 'citizen_joe', role: 'CITIZEN' };
      const res = authService.evaluate({
        user: citizenUser,
        permissionId: 'admin:manage:users'
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe('DENY');
    });

    test('should deny requests for unregistered permissions', () => {
      const adminUser = { id: 2, username: 'admin_bob', role: 'ADMIN' };
      const res = authService.evaluate({
        user: adminUser,
        permissionId: 'nonexistent:permission:id'
      });
      expect(res.allowed).toBe(false);
      expect(res.decision).toBe('DENY');
    });

    test('should allow authorized role for designated permission', () => {
      const adminUser = { id: 2, username: 'admin_bob', role: 'ADMIN' };
      const res = authService.evaluate({
        user: adminUser,
        permissionId: 'admin:manage:users'
      });
      expect(res.allowed).toBe(true);
      expect(res.decision).toBe('ALLOW');
    });
  });

  describe('4. Break-Glass Emergency Overrides', () => {
    test('should activate time-bounded break-glass session and grant emergency access', () => {
      const operatorUser = { id: 99, username: 'emerg_op', role: 'VALIDATOR_OPERATOR' };

      // Normal check: operator cannot halt validator
      expect(authService.isAuthorized(operatorUser, 'recovery:halt:validator')).toBe(false);

      // Activate break-glass
      const session = authService.activateBreakGlass({
        operatorId: 'emerg_op',
        reason: 'Consensus deadlocked on node 3',
        durationSeconds: 300,
        approverId: 'super_admin'
      });

      expect(session.operatorId).toBe('emerg_op');
      expect(authService.isBreakGlassActive('emerg_op')).toBe(true);

      // Now emergency access evaluates to ALLOW
      const res = authService.evaluate({
        user: operatorUser,
        permissionId: 'recovery:halt:validator'
      });
      expect(res.allowed).toBe(true);
      expect(res.reason).toContain('Break-Glass');

      // Revoke break-glass
      authService.revokeBreakGlass({ operatorId: 'emerg_op', reason: 'Incident mitigated' });
      expect(authService.isBreakGlassActive('emerg_op')).toBe(false);

      // Denied again
      expect(authService.isAuthorized(operatorUser, 'recovery:halt:validator')).toBe(false);
    });
  });
});

