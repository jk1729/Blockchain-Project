/**
 * PDSChain Simulation Safety Guard (Phase 20 - Stage D)
 * 
 * Strict runtime protection system preventing simulation execution in production
 * environments or against live infrastructure.
 * 
 * Invariants:
 * 1. Simulations MUST NOT run in production (NODE_ENV=production or ENVIRONMENT=production).
 * 2. Simulations require explicit SIMULATION_MODE=true.
 * 3. Targets must be loopback (localhost, 127.0.0.1) or explicitly allowlisted.
 * 4. Database paths must be isolated (in-memory or sandbox directories).
 * 5. Global emergency stop can instantly halt all simulation runs.
 * 6. Hard caps on duration, concurrency, and payload sizes.
 */

const path = require('path');

class SafetyGuardError extends Error {
  constructor(message, code = 'E_SIMULATION_SAFETY_VIOLATION', details = {}) {
    super(message);
    this.name = 'SafetyGuardError';
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class SafetyGuard {
  static #emergencyStop = false;
  static #emergencyStopReason = null;
  static #emergencyStopTimestamp = null;

  // Resource limits
  static DEFAULT_MAX_DURATION_MS = 60000;
  static DEFAULT_MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB
  static DEFAULT_MAX_CONCURRENCY = 20;

  static ALLOWED_LOOPBACK_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '::1',
    '0.0.0.0'
  ]);

  /**
   * Check if simulation mode is explicitly enabled.
   */
  static isSimulationModeActive() {
    const val = (process.env.SIMULATION_MODE || '').toLowerCase().trim();
    return val === 'true' || val === '1';
  }

  /**
   * Check if performance test mode is explicitly enabled.
   */
  static isPerformanceModeActive() {
    const val = (process.env.PERFORMANCE_TEST_MODE || '').toLowerCase().trim();
    return val === 'true' || val === '1' || this.isSimulationModeActive();
  }

  /**
   * Check if running in a production environment.
   */
  static isProductionEnvironment() {
    const nodeEnv = (process.env.NODE_ENV || '').toLowerCase().trim();
    const env = (process.env.ENVIRONMENT || '').toLowerCase().trim();
    return nodeEnv === 'production' || env === 'production' || nodeEnv === 'prod' || env === 'prod';
  }

  /**
   * Check if target hostname or URL is allowed (loopback or explicitly allowlisted).
   */
  static isAllowedHost(target) {
    if (!target) return true;

    let hostname = target;
    try {
      if (target.includes('://')) {
        const parsed = new URL(target);
        hostname = parsed.hostname;
      } else {
        hostname = target.split(':')[0];
      }
    } catch {
      return false;
    }

    hostname = hostname.toLowerCase().trim();

    if (this.ALLOWED_LOOPBACK_HOSTS.has(hostname)) {
      return true;
    }

    // Check optional explicit whitelist from env
    const allowedEnv = process.env.SIMULATION_ALLOWED_HOSTS;
    if (allowedEnv) {
      const allowedList = allowedEnv.split(',').map(h => h.trim().toLowerCase());
      if (allowedList.includes(hostname)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Verify database path or connection URL is strictly non-production and isolated.
   */
  static validateDatabaseTarget(dbTarget) {
    if (!dbTarget) return true;

    const lower = String(dbTarget).toLowerCase();

    // Reject production keywords in db connection strings
    const forbiddenKeywords = ['prod', 'production', 'mainnet', 'cluster', 'rds.amazonaws.com', 'azure.com', 'googlecloud.com'];
    for (const kw of forbiddenKeywords) {
      if (lower.includes(kw)) {
        throw new SafetyGuardError(
          `Database target "${dbTarget}" appears to be a production resource (contains "${kw}")`,
          'E_SIMULATION_PRODUCTION_DATABASE',
          { target: dbTarget, forbiddenKeyword: kw }
        );
      }
    }

    // Reject remote non-sqlite/non-local databases unless explicitly permitted
    if (lower.startsWith('postgres://') || lower.startsWith('postgresql://') || lower.startsWith('mysql://')) {
      // Must be localhost
      if (!lower.includes('localhost') && !lower.includes('127.0.0.1')) {
        throw new SafetyGuardError(
          `Remote database connection refused for simulation: ${dbTarget}`,
          'E_SIMULATION_REMOTE_DATABASE',
          { target: dbTarget }
        );
      }
    }

    return true;
  }

  /**
   * Validate that a filesystem storage path is safely scoped to a disposable sandbox.
   */
  static validateSandboxPath(sandboxPath) {
    if (!sandboxPath) return true;

    const normalized = path.resolve(sandboxPath);
    const basename = path.basename(normalized);

    // Sandbox directories must start with tmp-sim- or tmp-perf- or be inside an explicitly isolated temp folder
    const isSandboxName = basename.startsWith('tmp-sim-') || basename.startsWith('tmp-perf-') || normalized.includes('tmp-sim-') || normalized.includes('tmp-perf-') || normalized.includes('scratch');
    if (!isSandboxName) {
      throw new SafetyGuardError(
        `Directory "${sandboxPath}" is not an authorized sandbox path (must match tmp-sim-* or tmp-perf-*)`,
        'E_SIMULATION_UNSAFE_DIRECTORY',
        { path: sandboxPath }
      );
    }

    return true;
  }

  /**
   * Trigger emergency stop to instantly abort all simulation activity.
   */
  static triggerEmergencyStop(reason = 'Operator emergency stop') {
    this.#emergencyStop = true;
    this.#emergencyStopReason = reason;
    this.#emergencyStopTimestamp = new Date().toISOString();
    return {
      emergencyStop: true,
      reason: this.#emergencyStopReason,
      timestamp: this.#emergencyStopTimestamp
    };
  }

  /**
   * Reset emergency stop state.
   */
  static resetEmergencyStop() {
    this.#emergencyStop = false;
    this.#emergencyStopReason = null;
    this.#emergencyStopTimestamp = null;
    return { emergencyStop: false };
  }

  /**
   * Query emergency stop status.
   */
  static isEmergencyStopActive() {
    return this.#emergencyStop;
  }

  /**
   * Get emergency stop details.
   */
  static getEmergencyStopDetails() {
    return {
      active: this.#emergencyStop,
      reason: this.#emergencyStopReason,
      timestamp: this.#emergencyStopTimestamp
    };
  }

  /**
   * Validate execution safety before launching any scenario.
   */
  static validateExecutionSafety(options = {}) {
    // 1. Check emergency stop
    if (this.#emergencyStop) {
      throw new SafetyGuardError(
        `Simulation execution blocked: Emergency stop is active (${this.#emergencyStopReason || 'Unknown reason'})`,
        'E_SIMULATION_EMERGENCY_STOP_ACTIVE',
        { reason: this.#emergencyStopReason, timestamp: this.#emergencyStopTimestamp }
      );
    }

    // 2. Check production environment
    if (this.isProductionEnvironment()) {
      throw new SafetyGuardError(
        'Simulation execution unconditionally refused: Running in production environment',
        'E_SIMULATION_PROD_ENV_REFUSED',
        { nodeEnv: process.env.NODE_ENV, environment: process.env.ENVIRONMENT }
      );
    }

    // 3. Check simulation or performance mode flag
    if (options.isPerformanceTest) {
      if (!this.isPerformanceModeActive()) {
        throw new SafetyGuardError(
          'Performance execution refused: PERFORMANCE_TEST_MODE environment variable must be set to "true"',
          'E_PERFORMANCE_MODE_DISABLED'
        );
      }
    } else if (!this.isSimulationModeActive()) {
      throw new SafetyGuardError(
        'Simulation execution refused: SIMULATION_MODE environment variable must be set to "true"',
        'E_SIMULATION_MODE_DISABLED'
      );
    }

    // 4. Validate target host/url if provided
    if (options.targetHost && !this.isAllowedHost(options.targetHost)) {
      throw new SafetyGuardError(
        `Target host "${options.targetHost}" is not allowed (only loopback or explicitly allowlisted hosts permitted)`,
        'E_SIMULATION_HOST_NOT_ALLOWED',
        { targetHost: options.targetHost }
      );
    }

    // 5. Validate database target if provided
    if (options.databaseTarget) {
      this.validateDatabaseTarget(options.databaseTarget);
    }

    // 6. Validate sandbox path if provided
    if (options.sandboxPath) {
      this.validateSandboxPath(options.sandboxPath);
    }

    // 7. Validate duration budget
    const maxDuration = parseInt(process.env.SIMULATION_MAX_DURATION_MS, 10) || this.DEFAULT_MAX_DURATION_MS;
    if (options.durationMs && options.durationMs > maxDuration) {
      throw new SafetyGuardError(
        `Requested duration ${options.durationMs}ms exceeds maximum allowed budget ${maxDuration}ms`,
        'E_SIMULATION_DURATION_EXCEEDED',
        { requestedDurationMs: options.durationMs, maxDurationMs: maxDuration }
      );
    }

    // 8. Validate payload size
    const maxPayload = this.DEFAULT_MAX_PAYLOAD_BYTES;
    if (options.payloadSizeBytes && options.payloadSizeBytes > maxPayload) {
      throw new SafetyGuardError(
        `Payload size ${options.payloadSizeBytes} bytes exceeds limit ${maxPayload} bytes`,
        'E_SIMULATION_PAYLOAD_TOO_LARGE',
        { payloadSizeBytes: options.payloadSizeBytes, maxPayloadBytes: maxPayload }
      );
    }

    // 9. Validate concurrency
    const maxConcurrency = this.DEFAULT_MAX_CONCURRENCY;
    if (options.concurrency && options.concurrency > maxConcurrency) {
      throw new SafetyGuardError(
        `Requested concurrency ${options.concurrency} exceeds maximum limit ${maxConcurrency}`,
        'E_SIMULATION_CONCURRENCY_EXCEEDED',
        { requestedConcurrency: options.concurrency, maxConcurrency }
      );
    }

    return true;
  }
}

module.exports = {
  SafetyGuard,
  SafetyGuardError
};

