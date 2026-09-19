/**
 * PDSChain Tamper-Evident Security Audit Logger (Phase 17)
 * 
 * Features:
 * - Append-only persistence in JSONL format.
 * - Blockchain-style cryptographic SHA-256 hash chaining for tamper detection.
 * - Strict recursive secret sanitization (zero keys, passphrases, tokens in logs).
 * - High-speed in-memory query, range filtering, and audit export.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { defaultSecurityMetrics } = require('./SecurityMetrics');

const GENESIS_PREVIOUS_HASH = '0'.repeat(64);
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passphrase/i,
  /privatekey/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /signature/i,
  /seed/i,
  /credential/i
];

function sanitizeSecrets(data, seen = new WeakSet()) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    // Redact Bearer tokens or 64-hex private keys if mistakenly passed
    if (data.startsWith('Bearer ') || (data.length === 64 && /^[0-9a-fA-F]{64}$/.test(data))) {
      return '[REDACTED_SECRET]';
    }
    return data;
  }
  if (typeof data !== 'object') return data;
  if (seen.has(data)) return '[CIRCULAR]';
  seen.add(data);

  if (Array.isArray(data)) {
    return data.map(item => sanitizeSecrets(item, seen));
  }

  const clean = {};
  for (const [key, value] of Object.entries(data)) {
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(rx => rx.test(key));
    if (isSensitive) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = sanitizeSecrets(value, seen);
    }
  }
  return clean;
}

class SecurityAuditLogger {
  /**
   * @param {object} [options]
   * @param {string} [options.filepath]
   * @param {boolean} [options.inMemoryOnly]
   * @param {SecurityMetrics} [options.metrics]
   */
  constructor(options = {}) {
    this.inMemoryOnly = options.inMemoryOnly || false;
    const os = require('os');
    const configuredPath = options.filepath || process.env.SECURITY_AUDIT_PATH;
    this.filepath = configuredPath
      ? path.resolve(configuredPath)
      : (process.env.NODE_ENV === 'test'
          ? path.join(os.tmpdir(), 'pdschain-test-isolated', 'security_audit_test.jsonl')
          : path.join(__dirname, '../../../../database/security_audit.jsonl'));
    this.metrics = options.metrics || defaultSecurityMetrics;

    this.entries = [];
    this.lastEntryHash = GENESIS_PREVIOUS_HASH;
    this.lastPersistenceError = null;

    if (!this.inMemoryOnly) {
      this._ensureStorage();
      this._replayExistingEntries();
    }
  }

  _ensureStorage() {
    try {
      const dir = path.dirname(this.filepath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      // Fall back to in-memory if filesystem unwritable
      this.inMemoryOnly = true;
    }
  }

  _replayExistingEntries() {
    try {
      if (!fs.existsSync(this.filepath)) return;
      const content = fs.readFileSync(this.filepath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim().length > 0);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          this.entries.push(entry);
          this.lastEntryHash = entry.entryHash;
        } catch (err) {
          // Corrupt line encountered
        }
      }
    } catch (err) {
      // Replay failed
    }
  }

  _computeHash(previousHash, payloadString) {
    return crypto.createHash('sha256').update(previousHash + payloadString, 'utf8').digest('hex');
  }

  /**
   * Record a security audit event
   * @param {object} params
   * @returns {object} Appended audit entry
   */
  logEvent(params = {}) {
    this.lastPersistenceError = null;
    const eventId = params.eventId || `audit_${crypto.randomBytes(12).toString('hex')}`;
    const existingEntry = this.entries.find(entry => entry.eventId === eventId);
    if (existingEntry) {
      const decision = params.decision === 'ALLOW' ? 'ALLOW' : 'DENY';
      const action = params.action || 'unknown';
      const resource = params.resource || 'unknown';
      if (existingEntry.action === action &&
          existingEntry.resource === resource &&
          existingEntry.decision === decision) {
        return existingEntry;
      }
      const collisionErr = new Error(`[SecurityAuditLogger] Collision detected: Audit event ID '${eventId}' already exists with conflicting payload.`);
      collisionErr.code = 'ERR_AUDIT_COLLISION';
      this.lastPersistenceError = collisionErr;
      throw collisionErr;
    }
    const timestamp = params.timestamp || new Date().toISOString();
    const actorId = params.actorId || 'anonymous';
    const actorType = params.actorType || 'PUBLIC';
    const decision = params.decision === 'ALLOW' ? 'ALLOW' : 'DENY';
    const permissionEvaluated = params.permissionEvaluated || 'none';
    const action = params.action || 'unknown';
    const resource = params.resource || 'unknown';
    const scope = params.scope || 'GLOBAL';
    const reason = params.reason || (decision === 'ALLOW' ? 'Authorized by policy' : 'Denied by default policy');
    const requestId = params.requestId || null;
    const correlationId = params.correlationId || null;

    const sanitizedDetails = sanitizeSecrets(params.details || {});

    // Canonical payload for hash calculation
    const hashablePayload = JSON.stringify({
      eventId,
      timestamp,
      actorId,
      actorType,
      permissionEvaluated,
      action,
      resource,
      scope,
      decision,
      reason,
      requestId,
      correlationId,
      details: sanitizedDetails
    });

    const previousEntryHash = this.lastEntryHash;
    const entryHash = this._computeHash(previousEntryHash, hashablePayload);

    const entry = {
      eventId,
      timestamp,
      actorId,
      actorType,
      permissionEvaluated,
      action,
      resource,
      scope,
      decision,
      reason,
      requestId,
      correlationId,
      details: sanitizedDetails,
      previousEntryHash,
      entryHash
    };

    // Persist append-only
    if (!this.inMemoryOnly) {
      try {
        fs.appendFileSync(this.filepath, JSON.stringify(entry) + '\n', 'utf8');
      } catch (err) {
        this.lastPersistenceError = err;
        return entry;
      }
    }

    this.entries.push(entry);
    this.lastEntryHash = entryHash;

    if (decision === 'DENY') {
      this.metrics.incrementAuthzDenial(resource, action);
    }

    return entry;
  }

  /**
   * Verify cryptographic integrity of entire audit log chain
   * @returns {{ valid: boolean, count: number, error?: string, brokenAtIndex?: number }}
   */
  verifyIntegrity() {
    let prevHash = GENESIS_PREVIOUS_HASH;

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      if (entry.previousEntryHash !== prevHash) {
        return {
          valid: false,
          count: this.entries.length,
          brokenAtIndex: i,
          error: `Hash chain broken at index ${i}: expected previousHash ${prevHash}, got ${entry.previousEntryHash}`
        };
      }

      const hashablePayload = JSON.stringify({
        eventId: entry.eventId,
        timestamp: entry.timestamp,
        actorId: entry.actorId,
        actorType: entry.actorType,
        permissionEvaluated: entry.permissionEvaluated,
        action: entry.action,
        resource: entry.resource,
        scope: entry.scope,
        decision: entry.decision,
        reason: entry.reason,
        requestId: entry.requestId,
        correlationId: entry.correlationId,
        details: entry.details
      });

      const calculatedHash = this._computeHash(prevHash, hashablePayload);
      if (calculatedHash !== entry.entryHash) {
        return {
          valid: false,
          count: this.entries.length,
          brokenAtIndex: i,
          error: `Tampered entry at index ${i}: payload hash mismatch`
        };
      }

      prevHash = entry.entryHash;
    }

    return {
      valid: true,
      count: this.entries.length
    };
  }

  /**
   * Query and filter audit log
   */
  query(filters = {}) {
    let result = [...this.entries];

    if (filters.actorId) {
      result = result.filter(e => e.actorId === filters.actorId);
    }
    if (filters.decision) {
      result = result.filter(e => e.decision === filters.decision.toUpperCase());
    }
    if (filters.permission) {
      result = result.filter(e => e.permissionEvaluated === filters.permission);
    }
    if (filters.resource) {
      result = result.filter(e => e.resource === filters.resource);
    }
    if (filters.fromTimestamp) {
      const from = new Date(filters.fromTimestamp).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= from);
    }
    if (filters.toTimestamp) {
      const to = new Date(filters.toTimestamp).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() <= to);
    }

    const limit = Math.min(parseInt(filters.limit, 10) || 50, 500);
    return result.slice(-limit);
  }

  getRecent(count = 20) {
    return this.entries.slice(-count);
  }

  getCount() {
    return this.entries.length;
  }

  clear() {
    this.entries = [];
    this.lastEntryHash = GENESIS_PREVIOUS_HASH;
    if (!this.inMemoryOnly && fs.existsSync(this.filepath)) {
      try {
        fs.unlinkSync(this.filepath);
      } catch (e) {}
    }
  }
}

const defaultSecurityAuditLogger = new SecurityAuditLogger();

module.exports = {
  SecurityAuditLogger,
  defaultSecurityAuditLogger,
  sanitizeSecrets,
  GENESIS_PREVIOUS_HASH
};
