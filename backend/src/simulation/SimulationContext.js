/**
 * PDSChain Simulation Context (Phase 20 - Stage C)
 * 
 * Manages the isolated execution lifecycle for a single simulation run.
 * Handles deterministic random number generation (PRNG), sandboxed directory
 * allocation, baseline snapshots, event logging, and guaranteed cleanup hooks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { SafetyGuard } = require('./SafetyGuard');

/**
 * Deterministic Pseudo-Random Number Generator (Mulberry32).
 */
class DeterministicPRNG {
  constructor(seed) {
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = Math.imul(31, hash) + seed.charCodeAt(i) | 0;
      }
      this.seed = hash >>> 0;
    } else if (typeof seed === 'number') {
      this.seed = seed >>> 0;
    } else {
      this.seed = (Date.now() ^ (Math.random() * 0x100000000)) >>> 0;
    }
    this.initialSeed = this.seed;
  }

  /**
   * Return float between 0 (inclusive) and 1 (exclusive).
   */
  random() {
    let t = this.seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Return integer between min (inclusive) and max (inclusive).
   */
  randomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /**
   * Choose random element from array.
   */
  choice(array) {
    if (!array || array.length === 0) return null;
    const index = this.randomInt(0, array.length - 1);
    return array[index];
  }

  /**
   * Return deterministic shuffled copy of array.
   */
  shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.randomInt(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

class SimulationContext {
  constructor(options = {}) {
    this.simulationId = options.simulationId || `sim-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.scenarioId = options.scenarioId || 'UNKNOWN';
    this.name = options.name || 'Unnamed Simulation';
    this.category = options.category || 'GENERAL';
    this.parameters = options.parameters || {};

    // PRNG initialization
    this.seed = options.seed !== undefined ? options.seed : (Date.now() & 0xFFFFFFFF);
    this.prng = new DeterministicPRNG(this.seed);

    // Sandbox storage
    const baseDir = options.sandboxBaseDir || path.join(os.tmpdir(), 'pdschain-simulations');
    this.sandboxPath = path.join(baseDir, `tmp-sim-${this.simulationId}`);

    // Verify sandbox path safety
    SafetyGuard.validateSandboxPath(this.sandboxPath);

    // Lifecycle state
    this.status = 'INITIALIZING';
    this.startTime = null;
    this.endTime = null;
    this.durationMs = 0;

    // Snapshot data
    this.baselineSnapshot = null;
    this.postRecoverySnapshot = null;

    // In-memory event audit trail
    this.events = [];
    this.errors = [];
    this.cleanupHooks = [];
    this.cleanedUp = false;

    // Telemetry and RPO/RTO metrics
    this.metrics = {
      faultInjectedAt: null,
      detectionAt: null,
      detectionLatencyMs: null,
      recoveryStartedAt: null,
      recoveryCompletedAt: null,
      recoveryLatencyMs: null,
      rpoBlocks: 0,
      rtoMs: 0
    };
  }

  /**
   * Initialize isolated sandbox directory.
   */
  async initialize() {
    this.startTime = Date.now();
    this.status = 'INITIALIZING';

    if (!fs.existsSync(this.sandboxPath)) {
      fs.mkdirSync(this.sandboxPath, { recursive: true });
    }

    this.recordEvent({
      phase: 'PREPARE',
      action: 'INIT_SANDBOX',
      actor: 'SimulationContext',
      result: 'SUCCESS',
      metadata: { sandboxPath: this.sandboxPath, seed: this.seed }
    });

    this.status = 'READY';
    return this;
  }

  /**
   * Record baseline state snapshot before fault injection.
   */
  captureBaseline(state = {}) {
    this.baselineSnapshot = {
      capturedAt: new Date().toISOString(),
      timestamp: Date.now(),
      ledgerHeight: state.ledgerHeight !== undefined ? state.ledgerHeight : 0,
      latestBlockHash: state.latestBlockHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      stateRoot: state.stateRoot || '0x0000000000000000000000000000000000000000000000000000000000000000',
      validatorCount: state.validatorCount || 4,
      mempoolSize: state.mempoolSize || 0,
      dbMetrics: state.dbMetrics || {},
      custom: state.custom || {}
    };

    this.recordEvent({
      phase: 'BASELINE',
      action: 'CAPTURE_BASELINE',
      actor: 'SimulationContext',
      result: 'SUCCESS',
      metadata: { height: this.baselineSnapshot.ledgerHeight }
    });

    return this.baselineSnapshot;
  }

  /**
   * Record post-recovery state snapshot.
   */
  capturePostRecovery(state = {}) {
    this.postRecoverySnapshot = {
      capturedAt: new Date().toISOString(),
      timestamp: Date.now(),
      ledgerHeight: state.ledgerHeight !== undefined ? state.ledgerHeight : 0,
      latestBlockHash: state.latestBlockHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      stateRoot: state.stateRoot || '0x0000000000000000000000000000000000000000000000000000000000000000',
      validatorCount: state.validatorCount || 4,
      mempoolSize: state.mempoolSize || 0,
      dbMetrics: state.dbMetrics || {},
      custom: state.custom || {}
    };

    if (this.baselineSnapshot) {
      // Calculate RPO: missing blocks between baseline and recovery
      const heightDiff = this.baselineSnapshot.ledgerHeight - this.postRecoverySnapshot.ledgerHeight;
      this.metrics.rpoBlocks = Math.max(0, heightDiff);
    }

    this.recordEvent({
      phase: 'RECOVERY',
      action: 'CAPTURE_POST_RECOVERY',
      actor: 'SimulationContext',
      result: 'SUCCESS',
      metadata: { height: this.postRecoverySnapshot.ledgerHeight, rpoBlocks: this.metrics.rpoBlocks }
    });

    return this.postRecoverySnapshot;
  }

  /**
   * Mark fault injection timestamp.
   */
  markFaultInjected() {
    this.metrics.faultInjectedAt = Date.now();
  }

  /**
   * Mark detection timestamp and calculate detection latency.
   */
  markDetected() {
    this.metrics.detectionAt = Date.now();
    if (this.metrics.faultInjectedAt) {
      this.metrics.detectionLatencyMs = this.metrics.detectionAt - this.metrics.faultInjectedAt;
    }
  }

  /**
   * Mark recovery start timestamp.
   */
  markRecoveryStarted() {
    this.metrics.recoveryStartedAt = Date.now();
  }

  /**
   * Mark recovery completion and calculate recovery latency / RTO.
   */
  markRecoveryCompleted() {
    this.metrics.recoveryCompletedAt = Date.now();
    if (this.metrics.recoveryStartedAt) {
      this.metrics.recoveryLatencyMs = this.metrics.recoveryCompletedAt - this.metrics.recoveryStartedAt;
      this.metrics.rtoMs = this.metrics.recoveryLatencyMs;
    }
  }

  /**
   * Register a cleanup hook to execute when simulation finishes.
   */
  registerCleanup(hookFn) {
    if (typeof hookFn === 'function') {
      this.cleanupHooks.push(hookFn);
    }
  }

  /**
   * Record a lifecycle or operational event.
   */
  recordEvent(eventData = {}) {
    const event = {
      simulationId: this.simulationId,
      scenarioId: this.scenarioId,
      phase: eventData.phase || 'EXECUTE',
      action: eventData.action || 'STEP',
      actor: eventData.actor || 'SYSTEM',
      timestamp: new Date().toISOString(),
      result: eventData.result || 'INFO',
      errorCode: eventData.errorCode || null,
      requestId: eventData.requestId || null,
      traceId: eventData.traceId || null,
      metadata: eventData.metadata || {}
    };

    this.events.push(event);
    return event;
  }

  /**
   * Record an error encountered during simulation.
   */
  recordError(error, phase = 'EXECUTE') {
    const errorRecord = {
      phase,
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      code: error.code || 'E_SIMULATION_ERROR',
      stack: process.env.NODE_ENV === 'test' ? error.stack : undefined
    };
    this.errors.push(errorRecord);
    this.recordEvent({
      phase,
      action: 'ERROR_OCCURRED',
      actor: 'SimulationContext',
      result: 'FAILURE',
      errorCode: errorRecord.code,
      metadata: { message: errorRecord.message }
    });
  }

  /**
   * Execute registered cleanup hooks and purge sandbox.
   */
  async cleanup() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    // Run registered cleanup hooks in reverse order (LIFO)
    while (this.cleanupHooks.length > 0) {
      const hook = this.cleanupHooks.pop();
      try {
        await hook();
      } catch (err) {
        this.recordError(err, 'CLEANUP');
      }
    }

    // Delete sandbox directory if it exists
    try {
      if (fs.existsSync(this.sandboxPath)) {
        fs.rmSync(this.sandboxPath, { recursive: true, force: true });
      }
    } catch (err) {
      this.recordError(err, 'CLEANUP_FS');
    }

    if (!this.endTime) {
      this.endTime = Date.now();
      this.durationMs = this.endTime - (this.startTime || this.endTime);
    }

    this.recordEvent({
      phase: 'CLEANUP',
      action: 'CLEANUP_COMPLETE',
      actor: 'SimulationContext',
      result: 'SUCCESS'
    });
  }

  /**
   * Export complete, sanitized evidence report.
   */
  generateEvidenceReport(overallResult = 'PASSED', invariantResults = []) {
    if (!this.endTime) {
      this.endTime = Date.now();
      this.durationMs = this.endTime - (this.startTime || this.endTime);
    }

    return {
      simulationId: this.simulationId,
      scenarioId: this.scenarioId,
      name: this.name,
      category: this.category,
      seed: this.seed,
      result: overallResult,
      status: this.status,
      startTime: this.startTime ? new Date(this.startTime).toISOString() : null,
      endTime: this.endTime ? new Date(this.endTime).toISOString() : null,
      durationMs: this.durationMs,
      metrics: this.metrics,
      baselineSnapshot: this.baselineSnapshot,
      postRecoverySnapshot: this.postRecoverySnapshot,
      invariants: invariantResults,
      eventsCount: this.events.length,
      errorsCount: this.errors.length,
      events: this.events,
      errors: this.errors,
      sandboxPath: this.sandboxPath,
      cleanedUp: this.cleanedUp
    };
  }
}

module.exports = {
  SimulationContext,
  DeterministicPRNG
};

