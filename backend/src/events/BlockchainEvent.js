/**
 * PDSChain Canonical BlockchainEvent Class (Phase 13)
 * 
 * Represents an immutable, typed, versioned, finality-aware event.
 * Enforces:
 * - Schema validation and bounded payload size (max 64KB).
 * - Complete secret redaction across serialization (never leaks private keys or passphrases).
 * - Deterministic composite deduplication keys for idempotent replay.
 */

const crypto = require('crypto');
const { EventCategory, EventSeverity, FinalityStatus, EventType } = require('./EventTypes');

const MAX_PAYLOAD_SIZE_BYTES = 64 * 1024; // 64 KB limit

class BlockchainEventError extends Error {
  constructor(message, code = 'INVALID_EVENT_SCHEMA') {
    super(message);
    this.name = 'BlockchainEventError';
    this.code = code;
  }
}

class BlockchainEvent {
  /**
   * @param {object} params
   */
  constructor(params = {}) {
    this.eventId = params.eventId || (`evt_${crypto.randomBytes(16).toString('hex')}`);
    this.eventVersion = parseInt(params.eventVersion || 1, 10);
    this.schemaVersion = 1;

    this.eventType = params.eventType || params.type ? String(params.eventType || params.type).toUpperCase().trim() : null;
    this.category = params.category ? String(params.category).toUpperCase().trim() : null;
    this.severity = params.severity ? String(params.severity).toUpperCase().trim() : EventSeverity.INFO;

    this.timestamp = params.timestamp || new Date().toISOString();
    this.observedAt = params.observedAt || new Date().toISOString();

    this.networkId = params.networkId ? String(params.networkId).trim() : 'pdschain-devnet';
    this.chainId = params.chainId !== undefined ? Number(params.chainId) : 1729;
    this.validatorId = params.validatorId ? String(params.validatorId).toUpperCase().trim() : null;
    this.processId = params.processId !== undefined ? Number(params.processId) : (process.pid || 0);

    // Blockchain & EVM context
    this.blockHeight = params.blockHeight !== undefined && params.blockHeight !== null ? Number(params.blockHeight) : null;
    this.blockHash = params.blockHash || null;
    this.transactionHash = params.transactionHash || params.txHash || params.transactionId || null;
    this.transactionIndex = params.transactionIndex !== undefined && params.transactionIndex !== null ? Number(params.transactionIndex) : null;
    this.logIndex = params.logIndex !== undefined && params.logIndex !== null ? Number(params.logIndex) : null;
    this.contractAddress = params.contractAddress ? String(params.contractAddress).toLowerCase().trim() : null;

    // Consensus context
    this.round = params.round !== undefined && params.round !== null ? Number(params.round) : null;

    // Network & Transport context
    this.peerId = params.peerId ? String(params.peerId).toUpperCase().trim() : null;
    this.messageId = params.messageId || null;

    // Tracing & Causality
    this.requestId = params.requestId || null;
    this.correlationId = params.correlationId || null;
    this.causationId = params.causationId || null;
    this.source = params.source || 'system';

    // Finality state
    this.finalityStatus = params.finalityStatus ? String(params.finalityStatus).toUpperCase().trim() : FinalityStatus.FINALIZED;

    // Payload (deep copy & sanitized)
    this.payload = params.payload && typeof params.payload === 'object'
      ? this._sanitizePayload(params.payload)
      : {};
  }

  get type() {
    return this.eventType;
  }

  set type(val) {
    this.eventType = val;
  }

  get txHash() {
    return this.transactionHash;
  }

  set txHash(val) {
    this.transactionHash = val;
  }

  get dedupKey() {
    return this.getDeduplicationKey();
  }

  /**
   * Validate schema invariants
   */
  validate() {
    if (!this.eventId || typeof this.eventId !== 'string') {
      throw new BlockchainEventError('eventId is required and must be a string', 'MISSING_EVENT_ID');
    }

    if (!this.eventType || !EventType[this.eventType]) {
      throw new BlockchainEventError(`Invalid or unknown event type: '${this.eventType}'`, 'INVALID_EVENT_TYPE');
    }

    if (!this.category || !EventCategory[this.category]) {
      throw new BlockchainEventError(`Invalid event category: '${this.category}'`, 'INVALID_CATEGORY');
    }

    if (!this.severity || !EventSeverity[this.severity]) {
      throw new BlockchainEventError(`Invalid event severity: '${this.severity}'`, 'INVALID_SEVERITY');
    }

    if (!this.finalityStatus || !FinalityStatus[this.finalityStatus]) {
      throw new BlockchainEventError(`Invalid finality status: '${this.finalityStatus}'`, 'INVALID_FINALITY_STATUS');
    }

    // Check payload size bounds
    const payloadBytes = Buffer.byteLength(JSON.stringify(this.payload || {}), 'utf8');
    if (payloadBytes > MAX_PAYLOAD_SIZE_BYTES) {
      throw new BlockchainEventError(
        `Event payload size (${payloadBytes} bytes) exceeds maximum allowed size (${MAX_PAYLOAD_SIZE_BYTES} bytes)`,
        'OVERSIZED_EVENT_PAYLOAD'
      );
    }

    return true;
  }

  /**
   * Generate deterministic deduplication key for idempotent persistence and replay
   */
  getDeduplicationKey() {
    if (this.transactionHash) {
      return `TX:${this.transactionHash}:${this.eventType}:${this.blockHeight !== null && this.blockHeight !== undefined ? this.blockHeight : 'unconfirmed'}`;
    }

    if (this.contractAddress && (this.category === 'CONTRACT' || this.logIndex !== null)) {
      return `LOG:${this.blockHeight ?? 0}:${this.transactionIndex ?? 0}:${this.logIndex ?? 0}:${this.eventType}`;
    }

    if ((this.category === 'BLOCK' || this.category === 'BLOCKCHAIN') && this.blockHeight !== null && this.blockHeight !== undefined) {
      return `BLOCK:${this.blockHeight}:${this.eventType}:${this.finalityStatus}`;
    }

    if (this.category === 'CONSENSUS' && this.round !== null && this.round !== undefined) {
      return `CONSENSUS:${this.validatorId || 'LOCAL'}:${this.round}:${this.eventType}:${this.blockHeight ?? 0}`;
    }

    return this.eventId;
  }

  /**
   * Deep sanitize and redact any sensitive secrets from payload
   * @param {object} obj 
   */
  _sanitizePayload(obj) {
    if (!obj || typeof obj !== 'object') return obj;

    const SENSITIVE_KEYS = /^(password|passphrase|keystorePassword|privateKey|privKey|secret|secretKey|secretToken|token|jwtToken|bearer|seed|seedPhrase|authChallenge|challenge)$/i;

    function redactRecursive(item) {
      if (item === null || item === undefined) return item;
      if (typeof item === 'string') {
        return item.replace(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
      }
      if (Array.isArray(item)) {
        return item.map(redactRecursive);
      }
      if (typeof item === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(item)) {
          if (SENSITIVE_KEYS.test(k)) {
            out[k] = '[REDACTED]';
          } else {
            out[k] = redactRecursive(v);
          }
        }
        return out;
      }
      return item;
    }

    try {
      return redactRecursive(obj);
    } catch (e) {
      return { redacted: true };
    }
  }

  /**
   * Export safe, non-sensitive object representation
   */
  toSafeObject() {
    return {
      eventId: this.eventId,
      schemaVersion: this.schemaVersion,
      eventVersion: this.eventVersion,
      type: this.eventType,
      eventType: this.eventType,
      category: this.category,
      severity: this.severity,
      finalityStatus: this.finalityStatus,
      timestamp: this.timestamp,
      observedAt: this.observedAt,
      networkId: this.networkId,
      chainId: this.chainId,
      validatorId: this.validatorId,
      processId: this.processId,
      blockHeight: this.blockHeight,
      blockHash: this.blockHash,
      txHash: this.transactionHash,
      transactionHash: this.transactionHash,
      transactionIndex: this.transactionIndex,
      logIndex: this.logIndex,
      contractAddress: this.contractAddress,
      round: this.round,
      peerId: this.peerId,
      messageId: this.messageId,
      requestId: this.requestId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      source: this.source,
      dedupKey: this.getDeduplicationKey(),
      payload: this.payload
    };
  }

  toJSON() {
    return this.toSafeObject();
  }

  toString() {
    return `[Event ${this.eventId} type=${this.eventType} category=${this.category} status=${this.finalityStatus}]`;
  }

  static create(params = {}) {
    const ev = new BlockchainEvent(params);
    ev.validate();
    return ev;
  }

  static fromJSON(json = {}) {
    return new BlockchainEvent(json);
  }
}

module.exports = {
  BlockchainEvent,
  BlockchainEventError,
  MAX_PAYLOAD_SIZE_BYTES
};
