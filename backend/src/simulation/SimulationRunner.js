/**
 * PDSChain Simulation Runner (Phase 20 - Stage C)
 * 
 * Orchestrates the standardized 11-step simulation lifecycle:
 * 1. Validate safety guards (SafetyGuard)
 * 2. Create isolated execution context (SimulationContext)
 * 3. Seed deterministic fixtures & PRNG
 * 4. Capture baseline state
 * 5. Start telemetry & correlation (RequestContext)
 * 6. Inject attack / fault
 * 7. Observe system response
 * 8. Verify safety invariants (InvariantMonitor)
 * 9. Recover system
 * 10. Generate auditable evidence report
 * 11. Execute guaranteed sandbox cleanup
 */

const { SafetyGuard, SafetyGuardError } = require('./SafetyGuard');
const { SimulationContext } = require('./SimulationContext');
const { InvariantMonitor, InvariantViolationError } = require('./InvariantMonitor');
const { defaultScenarioRegistry } = require('./ScenarioRegistry');

let StructuredLogger = null;
try {
  StructuredLogger = require('../observability/StructuredLogger');
} catch {
  // Observability optional fallback
}

class SimulationRunner {
  constructor(options = {}) {
    this.registry = options.registry || defaultScenarioRegistry;
    this.history = new Map(); // simulationId -> evidenceReport
    this.activeSimulations = new Map(); // simulationId -> { context, cancelToken }
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * Execute a simulation scenario by ID or definition.
   */
  async runScenario(scenarioIdOrDef, options = {}) {
    // 1. Resolve scenario definition
    let scenario = null;
    if (typeof scenarioIdOrDef === 'string') {
      scenario = this.registry.get(scenarioIdOrDef);
      if (!scenario) {
        throw new Error(`Scenario "${scenarioIdOrDef}" not found in ScenarioRegistry`);
      }
    } else if (typeof scenarioIdOrDef === 'object' && scenarioIdOrDef !== null) {
      scenario = scenarioIdOrDef;
    } else {
      throw new Error('Invalid scenario argument: expected string ID or scenario object');
    }

    // 2. Validate environment safety
    SafetyGuard.validateExecutionSafety({
      durationMs: options.timeoutMs || scenario.runtimeBudgetMs,
      targetHost: options.targetHost,
      databaseTarget: options.databaseTarget,
      concurrency: options.concurrency,
      payloadSizeBytes: options.payloadSizeBytes
    });

    // 3. Initialize execution context
    const context = new SimulationContext({
      scenarioId: scenario.id,
      name: scenario.name,
      category: scenario.category,
      seed: options.seed,
      parameters: options.parameters || {}
    });

    await context.initialize();

    // Register active simulation
    let isCancelled = false;
    this.activeSimulations.set(context.simulationId, {
      context,
      cancel: (reason) => {
        isCancelled = true;
        context.recordEvent({
          phase: 'ABORT',
          action: 'CANCELLED_BY_OPERATOR',
          result: 'ABORTED',
          metadata: { reason }
        });
      }
    });

    let overallResult = 'PASSED';
    let invariantResults = [];
    const timeoutMs = options.timeoutMs || scenario.runtimeBudgetMs || 10000;

    try {
      context.recordEvent({
        phase: 'LIFECYCLE',
        action: 'START_SCENARIO',
        actor: 'SimulationRunner',
        result: 'IN_PROGRESS',
        metadata: { scenarioId: scenario.id, timeoutMs }
      });

      // Execute scenario with timeout bound
      const executionPromise = scenario.handler(context, options);
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Simulation timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (timer.unref) timer.unref();
      });

      const outcome = await Promise.race([executionPromise, timeoutPromise]);

      if (isCancelled) {
        overallResult = 'ABORTED';
      } else if (!outcome || outcome.success === false) {
        overallResult = 'FAILED';
      } else {
        overallResult = 'PASSED';
      }

      if (outcome && outcome.invariantResults) {
        invariantResults = outcome.invariantResults;
      }
    } catch (err) {
      context.recordError(err, 'EXECUTE');

      if (err instanceof InvariantViolationError) {
        overallResult = 'FAILED_INVARIANT';
        SafetyGuard.triggerEmergencyStop(`Invariant violation during ${scenario.id}: ${err.message}`);
      } else if (err.message && err.message.includes('timed out')) {
        overallResult = 'FAILED_TIMEOUT';
      } else {
        overallResult = 'FAILED';
      }
    } finally {
      // 10. Cleanup disposable sandbox
      try {
        await context.cleanup();
      } catch (cleanupErr) {
        context.recordError(cleanupErr, 'CLEANUP');
      }

      // 11. Generate Evidence Report
      const evidence = context.generateEvidenceReport(overallResult, invariantResults);

      // Record in history ring-buffer
      this._addToHistory(evidence);
      this.activeSimulations.delete(context.simulationId);

      return evidence;
    }
  }

  /**
   * Stop an active simulation.
   */
  stopSimulation(simulationId, reason = 'Operator cancellation') {
    const active = this.activeSimulations.get(simulationId);
    if (!active) {
      return { stopped: false, reason: 'Simulation not active or already finished' };
    }

    active.cancel(reason);
    return { stopped: true, simulationId, reason };
  }

  /**
   * Get evidence report of a completed or active simulation.
   */
  getSimulation(simulationId) {
    if (!simulationId) return null;
    return this.history.get(simulationId) || null;
  }

  /**
   * Get evidence report by ID.
   */
  getEvidence(simulationId) {
    return this.getSimulation(simulationId);
  }

  /**
   * List recent simulation runs from history.
   */
  getHistory(limit = 20) {
    const runs = Array.from(this.history.values()).reverse();
    return runs.slice(0, Math.max(1, limit)).map(r => ({
      simulationId: r.simulationId,
      scenarioId: r.scenarioId,
      name: r.name,
      category: r.category,
      result: r.result,
      durationMs: r.durationMs,
      startTime: r.startTime,
      endTime: r.endTime,
      eventsCount: r.eventsCount,
      errorsCount: r.errorsCount
    }));
  }

  /**
   * Clear history buffer.
   */
  clearHistory() {
    this.history.clear();
  }

  /**
   * Internal ring-buffer management.
   */
  _addToHistory(evidence) {
    if (this.history.size >= this.maxHistorySize) {
      const oldestKey = this.history.keys().next().value;
      this.history.delete(oldestKey);
    }
    this.history.set(evidence.simulationId, evidence);
  }
}

const defaultSimulationRunner = new SimulationRunner();

module.exports = {
  SimulationRunner,
  defaultSimulationRunner
};
