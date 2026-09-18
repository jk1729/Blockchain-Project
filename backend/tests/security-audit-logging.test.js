/**
 * Phase 17 Test Suite 8: Tamper-Evident Security Audit Logging & Prometheus Metrics
 */

const {
  SecurityAuditLogger,
  SecurityMetrics,
  sanitizeSecrets
} = require('../src/security/permissions');

describe('Phase 17: Security Audit Logging & Prometheus Telemetry', () => {
  let auditLogger;
  let metrics;

  beforeEach(() => {
    metrics = new SecurityMetrics();
    auditLogger = new SecurityAuditLogger({ inMemoryOnly: true, metrics });
  });

  describe('1. Cryptographic Hash Chaining & Integrity Verification', () => {
    test('should append log entries and maintain valid SHA-256 hash chain', () => {
      auditLogger.logEvent({
        actorId: 'admin_1',
        actorType: 'ADMIN',
        permissionEvaluated: 'admin:manage:users',
        action: 'create-user',
        decision: 'ALLOW'
      });

      auditLogger.logEvent({
        actorId: 'anonymous',
        actorType: 'PUBLIC',
        permissionEvaluated: 'security:rotate:certificate',
        action: 'rotate',
        decision: 'DENY',
        reason: 'Missing authentication'
      });

      expect(auditLogger.getCount()).toBe(2);

      const integrity = auditLogger.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.count).toBe(2);
    });

    test('should detect tampering if an entry payload is modified post-append', () => {
      auditLogger.logEvent({ actorId: 'actor_a', action: 'action_1', decision: 'ALLOW' });
      auditLogger.logEvent({ actorId: 'actor_b', action: 'action_2', decision: 'DENY' });
      auditLogger.logEvent({ actorId: 'actor_c', action: 'action_3', decision: 'ALLOW' });

      expect(auditLogger.verifyIntegrity().valid).toBe(true);

      // Tamper with middle entry
      auditLogger.entries[1].decision = 'ALLOW'; // Attacker attempts to flip DENY to ALLOW

      const tamperedCheck = auditLogger.verifyIntegrity();
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.brokenAtIndex).toBe(1);
      expect(tamperedCheck.error).toContain('payload hash mismatch');
    });

    test('should detect tampering if an entry is deleted or hash chain is broken', () => {
      auditLogger.logEvent({ actorId: 'actor_1', action: 'act_1' });
      auditLogger.logEvent({ actorId: 'actor_2', action: 'act_2' });
      auditLogger.logEvent({ actorId: 'actor_3', action: 'act_3' });

      // Attacker drops first entry
      auditLogger.entries.splice(0, 1);

      const check = auditLogger.verifyIntegrity();
      expect(check.valid).toBe(false);
      expect(check.error).toContain('Hash chain broken');
    });
  });

  describe('2. Secret Redaction & Data Privacy', () => {
    test('sanitizeSecrets should recursively redact passwords, private keys, tokens, and passphrases', () => {
      const sensitivePayload = {
        username: 'operator_bob',
        password: 'SuperSecretPassword123!',
        keystore: {
          passphrase: 'MasterKeyPassphrase',
          privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        },
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MX0'
      };

      const clean = sanitizeSecrets(sensitivePayload);

      expect(clean.username).toBe('operator_bob');
      expect(clean.password).toBe('[REDACTED]');
      expect(clean.keystore.passphrase).toBe('[REDACTED]');
      expect(clean.keystore.privateKey).toBe('[REDACTED]');
      expect(clean.token).toBe('[REDACTED]');
    });

    test('logEvent should never store plain text secrets in audit records', () => {
      const entry = auditLogger.logEvent({
        actorId: 'admin_sec',
        action: 'key-test',
        details: {
          privateKey: 'unredacted_private_key_data',
          safeParam: 'public_id_123'
        }
      });

      expect(entry.details.privateKey).toBe('[REDACTED]');
      expect(entry.details.safeParam).toBe('public_id_123');
    });
  });

  describe('3. Prometheus Security Metrics Exporter', () => {
    test('should track auth failures, denials, and privileged actions', () => {
      metrics.incrementAuthFailure('bad_password');
      metrics.incrementAuthFailure('bad_password');
      metrics.incrementAuthzDenial('user', 'manage');
      metrics.incrementPrivilegedAction('security:rotate:certificate');
      metrics.incrementBreakGlass();

      const snapshot = metrics.getSnapshot();
      expect(snapshot.authFailures).toBe(2);
      expect(snapshot.authzDenials).toBe(1);
      expect(snapshot.privilegedActions).toBe(1);
      expect(snapshot.breakGlassActivations).toBe(1);

      const promText = metrics.toPrometheusFormat();
      expect(promText).toContain('pds_security_auth_failures_total 2');
      expect(promText).toContain('pds_security_authz_denials_total 1');
      expect(promText).toContain('pds_security_break_glass_total 1');
      expect(promText).toContain('pds_security_privileged_actions_total 1');
    });
  });
});

