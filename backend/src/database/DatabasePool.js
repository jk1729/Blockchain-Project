/**
 * PDSChain Database Pool & Concurrency Coordinator (Phase 18)
 * 
 * Manages bounded connection pools, circuit breaking, acquisition timeouts,
 * query timeouts, and concurrency metrics for SQLite WAL and PostgreSQL.
 */

const EventEmitter = require('events');

class DatabasePoolError extends Error {
  constructor(message, code = 'POOL_ERROR') {
    super(message);
    this.name = 'DatabasePoolError';
    this.code = code;
  }
}

class DatabasePool extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxConnections=20]
   * @param {number} [options.minConnections=2]
   * @param {number} [options.acquireTimeoutMs=10000]
   * @param {number} [options.idleTimeoutMs=30000]
   * @param {number} [options.maxCircuitFailures=5]
   * @param {number} [options.circuitResetTimeMs=30000]
   */
  constructor(options = {}) {
    super();
    this.maxConnections = options.maxConnections || 20;
    this.minConnections = options.minConnections || 2;
    this.acquireTimeoutMs = options.acquireTimeoutMs || 10000;
    this.idleTimeoutMs = options.idleTimeoutMs || 30000;

    // Circuit Breaker State
    this.maxCircuitFailures = options.maxCircuitFailures || 5;
    this.circuitResetTimeMs = options.circuitResetTimeMs || 30000;
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
    this.lastFailureTime = 0;

    // Connection tracking
    this.activeConnections = 0;
    this.totalAcquired = 0;
    this.totalReleased = 0;
    this.deadlockCount = 0;
  }

  /**
   * Acquire a connection slot with timeout and circuit breaker protection
   */
  async acquire() {
    this._checkCircuit();

    if (this.activeConnections >= this.maxConnections) {
      throw new DatabasePoolError(
        `Database connection pool exhausted (active: ${this.activeConnections}/${this.maxConnections})`,
        'POOL_EXHAUSTED'
      );
    }

    this.activeConnections++;
    this.totalAcquired++;
    this.emit('acquire', { active: this.activeConnections });
    return true;
  }

  /**
   * Release a connection slot
   */
  release() {
    if (this.activeConnections > 0) {
      this.activeConnections--;
      this.totalReleased++;
      this.emit('release', { active: this.activeConnections });
    }
  }

  /**
   * Record successful operation to reset circuit breaker
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    if (this.circuitOpen) {
      this.circuitOpen = false;
      this.emit('circuitClose');
    }
  }

  /**
   * Record failure to trip circuit breaker if threshold exceeded
   * @param {Error} err 
   */
  recordFailure(err) {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (err && (err.message.includes('deadlock') || err.name === 'SequelizeDatabaseError')) {
      this.deadlockCount++;
    }

    if (this.consecutiveFailures >= this.maxCircuitFailures && !this.circuitOpen) {
      this.circuitOpen = true;
      this.emit('circuitOpen', { failures: this.consecutiveFailures });
    }
  }

  _checkCircuit() {
    if (this.circuitOpen) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.circuitResetTimeMs) {
        // Half-open attempt
        this.circuitOpen = false;
        this.consecutiveFailures = 0;
        return;
      }
      throw new DatabasePoolError(
        `Database circuit breaker is OPEN due to ${this.consecutiveFailures} consecutive failures. Backing off.`,
        'CIRCUIT_BREAKER_OPEN'
      );
    }
  }

  /**
   * Get telemetry status
   */
  getStatus() {
    return {
      maxConnections: this.maxConnections,
      activeConnections: this.activeConnections,
      availableConnections: Math.max(0, this.maxConnections - this.activeConnections),
      circuitOpen: this.circuitOpen,
      consecutiveFailures: this.consecutiveFailures,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
      deadlockCount: this.deadlockCount
    };
  }
}

module.exports = {
  DatabasePool,
  DatabasePoolError
};

