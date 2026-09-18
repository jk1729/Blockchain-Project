/**
 * PDSChain Workload Execution Context (Phase 21 - Stage C)
 * 
 * Encapsulates the execution context for a single performance test run.
 * Manages deterministic PRNG seeding, isolated temporary sandboxes (tmp-perf-*),
 * baseline/post-run snapshots, measurement collection, and cleanup hooks.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { SafetyGuard } = require('../simulation/SafetyGuard');
const { DeterministicPRNG } = require('../simulation/SimulationContext');
const { MeasurementCollector } = require('./MeasurementCollector');

class WorkloadContext {
  constructor(options = {}) {
    this.performanceRunId = options.performanceRunId || `perf-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    this.workloadId = options.workloadId || 'DEFAULT';
    this.name = options.name || 'Unnamed Workload';
    this.category = options.category || 'GENERAL';
    this.parameters = options.parameters || {};

    // Deterministic PRNG
    this.seed = options.seed !== undefined ? options.seed : (Date.now() & 0xFFFFFFFF);
    this.prng = new DeterministicPRNG(this.seed);

    // Sandbox storage
    const baseDir = options.sandboxBaseDir || path.join(os.tmpdir(), 'pdschain-performance');
    this.sandboxPath = path.join(baseDir, `tmp-perf-${this.performanceRunId}`);

    // Verify sandbox path safety
    SafetyGuard.validateSandboxPath(this.sandboxPath);

    // Lifecycle state
    this.status = 'INITIALIZING';
    this.startTime = null;
    this.endTime = null;
    this.durationMs = 0;

    // Measurement collector
    this.collector = new MeasurementCollector({ name: this.workloadId });

    // Snapshots
    this.baselineSnapshot = null;
    this.postRunSnapshot = null;

    // Cleanup hooks
    this.cleanupHooks = [];
    this.cleanedUp = false;
    this.errors = [];
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

    this.collector.startResourceSampling(500);
    this.status = 'READY';
    return this;
  }

  /**
   * Capture pre-test baseline snapshot.
   */
  captureBaseline(state = {}) {
    this.baselineSnapshot = {
      capturedAt: new Date().toISOString(),
      timestamp: Date.now(),
      ledgerHeight: state.ledgerHeight !== undefined ? state.ledgerHeight : 0,
      latestBlockHash: state.latestBlockHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      dbRowCount: state.dbRowCount || 0,
      mempoolSize: state.mempoolSize || 0
    };
    return this.baselineSnapshot;
  }

  /**
   * Capture post-test snapshot.
   */
  capturePostRun(state = {}) {
    this.postRunSnapshot = {
      capturedAt: new Date().toISOString(),
      timestamp: Date.now(),
      ledgerHeight: state.ledgerHeight !== undefined ? state.ledgerHeight : 0,
      latestBlockHash: state.latestBlockHash || '0x0000000000000000000000000000000000000000000000000000000000000000',
      dbRowCount: state.dbRowCount || 0,
      mempoolSize: state.mempoolSize || 0
    };
    return this.postRunSnapshot;
  }

  /**
   * Register a cleanup hook to execute after test completion.
   */
  registerCleanup(hookFn) {
    if (typeof hookFn === 'function') {
      this.cleanupHooks.push(hookFn);
    }
  }

  /**
   * Record an error during workload execution.
   */
  recordError(error) {
    this.errors.push({
      timestamp: new Date().toISOString(),
      message: error.message || String(error),
      code: error.code || 'E_WORKLOAD_ERROR'
    });
  }

  /**
   * Execute registered cleanup hooks and remove sandbox directory.
   */
  async cleanup() {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    this.collector.stopResourceSampling();

    while (this.cleanupHooks.length > 0) {
      const hook = this.cleanupHooks.pop();
      try {
        await hook();
      } catch (err) {
        this.recordError(err);
      }
    }

    try {
      if (fs.existsSync(this.sandboxPath)) {
        fs.rmSync(this.sandboxPath, { recursive: true, force: true });
      }
    } catch (err) {
      this.recordError(err);
    }

    if (!this.endTime) {
      this.endTime = Date.now();
      this.durationMs = this.endTime - (this.startTime || this.endTime);
      this.collector.durationMs = this.durationMs;
    }
  }
}

module.exports = { WorkloadContext };

