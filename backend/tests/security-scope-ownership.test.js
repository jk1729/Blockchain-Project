/**
 * Phase 17 Test Suite 5: Object-Level Ownership & Scope Validation (IDOR/BOLA Defense)
 */

const {
  AuthorizationService,
  defaultSecurityMetrics
} = require('../src/security/permissions');

describe('Phase 17: Object-Level Scope & Ownership Validation (IDOR/BOLA Protection)', () => {
  let authService;

  beforeEach(() => {
    defaultSecurityMetrics.reset();
    authService = new AuthorizationService({ metrics: defaultSecurityMetrics });
  });

  describe('1. User Scope Ownership Checks', () => {
    test('user should be allowed to access their own user-scoped account data', () => {
      const citizen = { id: 101, username: 'citizen_john', role: 'CITIZEN' };
      const res = authService.evaluate({
        user: citizen,
        permissionId: 'client:read:account',
        context: { targetUserId: 101 }
      });

      expect(res.allowed).toBe(true);
      expect(res.decision).toBe('ALLOW');
    });

    test('user should be denied when attempting to access another user data (IDOR)', () => {
      const citizen = { id: 101, username: 'citizen_john', role: 'CITIZEN' };
      const res = authService.evaluate({
        user: citizen,
        permissionId: 'client:read:account',
        context: { targetUserId: 202 }
      });

      expect(res.allowed).toBe(false);
      expect(res.decision).toBe('DENY');
      expect(res.reason).toContain('Object-level ownership failure');
      expect(defaultSecurityMetrics.getSnapshot().idorAttempts).toBe(1);
    });

    test('admin should be permitted to inspect any user account', () => {
      const admin = { id: 1, username: 'admin_root', role: 'ADMIN' };
      const res = authService.evaluate({
        user: admin,
        permissionId: 'client:read:account',
        context: { targetUserId: 202 }
      });

      expect(res.allowed).toBe(true);
      expect(res.decision).toBe('ALLOW');
    });
  });

  describe('2. Entity Scope Ownership Checks', () => {
    test('shop officer should be allowed to distribute rations for assigned shopId', () => {
      const shopOfficer = { id: 10, username: 'shop_manager', role: 'SHOP', entityId: 'FPS-101' };
      const res = authService.evaluate({
        user: shopOfficer,
        permissionId: 'pds:distribute:rations',
        context: { targetEntityId: 'FPS-101' }
      });

      expect(res.allowed).toBe(true);
      expect(res.decision).toBe('ALLOW');
    });

    test('shop officer should be denied when attempting to distribute from another shop (BOLA)', () => {
      const shopOfficer = { id: 10, username: 'shop_manager', role: 'SHOP', entityId: 'FPS-101' };
      const res = authService.evaluate({
        user: shopOfficer,
        permissionId: 'pds:distribute:rations',
        context: { targetEntityId: 'FPS-999' }
      });

      expect(res.allowed).toBe(false);
      expect(res.decision).toBe('DENY');
      expect(res.reason).toContain('Entity scope violation');
      expect(defaultSecurityMetrics.getSnapshot().idorAttempts).toBe(1);
    });

    test('warehouse manager should be allowed to transfer stock from assigned warehouseId', () => {
      const whManager = { id: 20, username: 'wh_officer', role: 'WAREHOUSE', entityId: 'WH-01' };
      const res = authService.evaluate({
        user: whManager,
        permissionId: 'pds:transfer:stock',
        context: { targetEntityId: 'WH-01' }
      });

      expect(res.allowed).toBe(true);
    });

    test('warehouse manager should be denied when attempting stock transfer from unassigned warehouse', () => {
      const whManager = { id: 20, username: 'wh_officer', role: 'WAREHOUSE', entityId: 'WH-01' };
      const res = authService.evaluate({
        user: whManager,
        permissionId: 'pds:transfer:stock',
        context: { targetEntityId: 'WH-02' }
      });

      expect(res.allowed).toBe(false);
      expect(res.reason).toContain('Entity scope violation');
    });
  });

  describe('3. Validator Scope Ownership Checks', () => {
    test('validator process should be restricted to its own node ID', () => {
      const val01 = { id: 1, username: 'VAL-01', role: 'VALIDATOR', entityId: 'VAL-01' };
      const resAllowed = authService.evaluate({
        user: val01,
        permissionId: 'validator:send:proposal',
        context: { targetValidatorId: 'VAL-01' }
      });
      expect(resAllowed.allowed).toBe(true);

      const resDenied = authService.evaluate({
        user: val01,
        permissionId: 'validator:send:proposal',
        context: { targetValidatorId: 'VAL-02' }
      });
      expect(resDenied.allowed).toBe(false);
      expect(resDenied.reason).toContain('Validator scope violation');
    });
  });
});

