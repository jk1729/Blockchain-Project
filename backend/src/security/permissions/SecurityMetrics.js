/**
 * PDSChain Security Metrics (Phase 17)
 * 
 * Prometheus-compatible security telemetry exporter.
 * Tracks authentication failures, authorization denials, privileged actions,
 * break-glass incidents, and cryptographic key events.
 * 
 * Invariant: Never utilizes secrets or unbounded user strings as metric labels.
 */

class SecurityMetrics {
  constructor() {
    this.counters = {
      authFailures: 0,
      authzDenials: 0,
      privilegedActions: 0,
      breakGlassActivations: 0,
      keyEvents: 0,
      rateLimitViolations: 0,
      suspiciousRequests: 0,
      idorAttempts: 0
    };

    // Label-bounded breakdowns
    this.authFailuresByReason = new Map();
    this.authzDenialsByResource = new Map();
    this.privilegedActionsByPerm = new Map();
  }

  incrementAuthFailure(reason = 'invalid_credentials') {
    this.counters.authFailures++;
    const safeReason = String(reason).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 32);
    this.authFailuresByReason.set(safeReason, (this.authFailuresByReason.get(safeReason) || 0) + 1);
  }

  incrementAuthzDenial(resource = 'unknown', action = 'unknown') {
    this.counters.authzDenials++;
    const safeKey = `${String(resource).toLowerCase()}:${String(action).toLowerCase()}`.replace(/[^a-z0-9_:]/g, '_').slice(0, 48);
    this.authzDenialsByResource.set(safeKey, (this.authzDenialsByResource.get(safeKey) || 0) + 1);
  }

  incrementPrivilegedAction(permissionId = 'unknown') {
    this.counters.privilegedActions++;
    const safePerm = String(permissionId).replace(/[^a-zA-Z0-9_:]/g, '_').slice(0, 64);
    this.privilegedActionsByPerm.set(safePerm, (this.privilegedActionsByPerm.get(safePerm) || 0) + 1);
  }

  incrementBreakGlass() {
    this.counters.breakGlassActivations++;
  }

  incrementKeyEvent() {
    this.counters.keyEvents++;
  }

  incrementRateLimitViolation() {
    this.counters.rateLimitViolations++;
  }

  incrementSuspiciousRequest() {
    this.counters.suspiciousRequests++;
  }

  incrementIdorAttempt() {
    this.counters.idorAttempts++;
  }

  getSnapshot() {
    return {
      timestamp: new Date().toISOString(),
      ...this.counters,
      authFailuresByReason: Object.fromEntries(this.authFailuresByReason),
      authzDenialsByResource: Object.fromEntries(this.authzDenialsByResource),
      privilegedActionsByPerm: Object.fromEntries(this.privilegedActionsByPerm)
    };
  }

  toPrometheusFormat() {
    const lines = [];
    lines.push('# HELP pds_security_auth_failures_total Total authentication failures');
    lines.push('# TYPE pds_security_auth_failures_total counter');
    lines.push(`pds_security_auth_failures_total ${this.counters.authFailures}`);

    for (const [reason, count] of this.authFailuresByReason.entries()) {
      lines.push(`pds_security_auth_failures_total{reason="${reason}"} ${count}`);
    }

    lines.push('# HELP pds_security_authz_denials_total Total authorization denials (Default Deny)');
    lines.push('# TYPE pds_security_authz_denials_total counter');
    lines.push(`pds_security_authz_denials_total ${this.counters.authzDenials}`);

    for (const [resAction, count] of this.authzDenialsByResource.entries()) {
      lines.push(`pds_security_authz_denials_total{target="${resAction}"} ${count}`);
    }

    lines.push('# HELP pds_security_privileged_actions_total Total privileged administrative or security operations executed');
    lines.push('# TYPE pds_security_privileged_actions_total counter');
    lines.push(`pds_security_privileged_actions_total ${this.counters.privilegedActions}`);

    for (const [perm, count] of this.privilegedActionsByPerm.entries()) {
      lines.push(`pds_security_privileged_actions_total{permission="${perm}"} ${count}`);
    }

    lines.push('# HELP pds_security_break_glass_total Total break-glass emergency activations');
    lines.push('# TYPE pds_security_break_glass_total counter');
    lines.push(`pds_security_break_glass_total ${this.counters.breakGlassActivations}`);

    lines.push('# HELP pds_security_key_events_total Total consensus and TLS key lifecycle events');
    lines.push('# TYPE pds_security_key_events_total counter');
    lines.push(`pds_security_key_events_total ${this.counters.keyEvents}`);

    lines.push('# HELP pds_security_rate_limit_violations_total Total rate limit violations detected');
    lines.push('# TYPE pds_security_rate_limit_violations_total counter');
    lines.push(`pds_security_rate_limit_violations_total ${this.counters.rateLimitViolations}`);

    lines.push('# HELP pds_security_suspicious_requests_total Total suspicious or malformed security requests intercepted');
    lines.push('# TYPE pds_security_suspicious_requests_total counter');
    lines.push(`pds_security_suspicious_requests_total ${this.counters.suspiciousRequests}`);

    lines.push('# HELP pds_security_idor_attempts_total Total object-level ownership bypass attempts (IDOR/BOLA)');
    lines.push('# TYPE pds_security_idor_attempts_total counter');
    lines.push(`pds_security_idor_attempts_total ${this.counters.idorAttempts}`);

    return lines.join('\n') + '\n';
  }

  reset() {
    this.counters = {
      authFailures: 0,
      authzDenials: 0,
      privilegedActions: 0,
      breakGlassActivations: 0,
      keyEvents: 0,
      rateLimitViolations: 0,
      suspiciousRequests: 0,
      idorAttempts: 0
    };
    this.authFailuresByReason.clear();
    this.authzDenialsByResource.clear();
    this.privilegedActionsByPerm.clear();
  }
}

const defaultSecurityMetrics = new SecurityMetrics();

module.exports = {
  SecurityMetrics,
  defaultSecurityMetrics
};

