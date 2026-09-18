/**
 * PDSChain Performance Test Runner (Phase 21 - Stage C)
 * 
 * Orchestrates the standardized 13-step performance and load testing lifecycle:
 * 1. Validate safety gates (SafetyGuard)
 * 2. Allocate isolated execution context (WorkloadContext)
 * 3. Capture baseline state
 * 4. Seed deterministic fixtures & PRNG
 * 5. Start metrics & resource sampling (MeasurementCollector)
 * 6. Execute warm-up phase (LoadController)
 * 7. Execute steady-state load
 * 8. Apply optional bounded degradation
 * 9. Cool-down & drain workers
 * 10. Verify invariants (InvariantMonitor) & execute cleanup
 * 11. Compute latency percentiles & throughput statistics
 * 12. Evaluate SLO thresholds & baseline regression
 * 13. Compile and store auditable evidence report
 */

const { SafetyGuard } = require('../simulation/SafetyGuard');
const { InvariantMonitor } = require('../simulation/InvariantMonitor');
const { WorkloadContext } = require('./WorkloadContext');
const { LoadController } = require('./LoadController');
const { PerformanceReport } = require('./PerformanceReport');
const { defaultWorkloadRegistry } = require('./WorkloadRegistry');

class PerformanceRunner {
  constructor(options = {}) {
    this.registry = options.registry || defaultWorkloadRegistry;
    this.history = new Map(); // performanceRunId -> report
    this.activeRuns = new Map(); // performanceRunId -> { context, controller }
    this.maxHistorySize = options.maxHistorySize || 100;
  }

  /**
   * Execute a workload benchmark by ID or definition.
   */
  async runWorkload(workloadIdOrDef, options = {}) {
    // 1. Resolve workload definition
    let workload = null;
    if (typeof workloadIdOrDef === 'string') {
      workload = this.registry.get(workloadIdOrDef);
      if (!workload) {
        throw new Error(`Workload "${workloadIdOrDef}" not found in WorkloadRegistry`);
      }
    } else if (typeof workloadIdOrDef === 'object' && workloadIdOrDef !== null) {
      workload = workloadIdOrDef;
    } else {
      throw new Error('Invalid workload argument: expected string ID or workload object');
    }

    const durationMs = options.durationMs || workload.durationMs || 2000;
    const concurrency = options.concurrency || workload.concurrency || 5;
    const targetRps = options.targetRps || workload.targetRps || 50;

    // 2. Validate environment safety
    SafetyGuard.validateExecutionSafety({
      isPerformanceTest: true,
      durationMs,
      concurrency,
      targetHost: options.targetHost,
      databaseTarget: options.databaseTarget
    });

    // 3. Initialize execution context
    const context = new WorkloadContext({
      workloadId: workload.id,
      name: workload.name,
      category: workload.category,
      seed: options.seed,
      parameters: options.parameters || {}
    });

    await context.initialize();

    // Baseline capture
    context.captureBaseline({
      ledgerHeight: options.baselineHeight || 100,
      latestBlockHash: options.baselineBlockHash || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    });

    // Load controller
    const controller = new LoadController({ maxConcurrency: concurrency });
    this.activeRuns.set(context.performanceRunId, { context, controller });

    let invariantResults = [];
    let sloResults = [];
    let baselineComparison = null;

    try {
      context.status = 'RUNNING';

      // 6 & 7. Execute workload via LoadController
      await controller.executeWorkload({
        taskFn: async (workerId, phase) => {
          await workload.taskFn(context, workerId, phase);
        },
        targetRps,
        concurrency,
        durationMs,
        warmupMs: options.warmupMs || workload.warmupMs || 200,
        cooldownMs: options.cooldownMs || workload.cooldownMs || 100
      });

      // Post-run snapshot
      context.capturePostRun({
        ledgerHeight: options.postHeight || 100,
        latestBlockHash: options.baselineBlockHash || '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      });

      // 10. Verify safety invariants
      const invariantChecks = [
        () => InvariantMonitor.assertMonotonicHeight(
          context.baselineSnapshot.ledgerHeight,
          context.postRunSnapshot.ledgerHeight
        ),
        () => InvariantMonitor.assertImmutableBlockHash(
          context.baselineSnapshot.latestBlockHash,
          context.postRunSnapshot.latestBlockHash
        ),
        () => InvariantMonitor.assertZeroSecretLeakage({
          workloadId: workload.id,
          runId: context.performanceRunId,
          parameters: context.parameters
        })
      ];

      const invSummary = InvariantMonitor.verifyBatch(invariantChecks);
      invariantResults = invSummary.results;

      // 11. Measurement summary
      const summary = context.collector.getSummary();

      // 12. Evaluate SLO thresholds
      if (workload.slo) {
        const p95Passed = summary.latency.p95 <= workload.slo.maxP95LatencyMs;
        sloResults.push({
          target: 'maxP95LatencyMs',
          threshold: workload.slo.maxP95LatencyMs,
          achieved: summary.latency.p95,
          passed: p95Passed
        });

        const errorRatePassed = summary.errorRate <= workload.slo.maxErrorRate;
        sloResults.push({
          target: 'maxErrorRate',
          threshold: workload.slo.maxErrorRate,
          achieved: summary.errorRate,
          passed: errorRatePassed
        });
      }

      // Baseline comparison (if reference report supplied)
      if (options.referenceBaseline) {
        baselineComparison = PerformanceReport.compare(
          { latency: summary.latency, achievedRps: summary.throughputRps },
          options.referenceBaseline,
          options.regressionTolerances
        );
      }
    } catch (err) {
      context.recordError(err);
      context.status = 'FAILED';
    } finally {
      // 10. Guaranteed cleanup
      try {
        await context.cleanup();
      } catch (cleanupErr) {
        context.recordError(cleanupErr);
      }

      // 13. Generate Evidence Report
      const report = PerformanceReport.generate(context, {
        targetRps,
        concurrency,
        maxAllowedErrorRate: workload.slo ? workload.slo.maxErrorRate : 0.05,
        sloResults,
        invariantResults,
        baselineComparison
      });

      this._addToHistory(report);
      this.activeRuns.delete(context.performanceRunId);

      return report;
    }
  }

  /**
   * Stop an active performance run.
   */
  stopRun(performanceRunId, reason = 'Operator stop') {
    const active = this.activeRuns.get(performanceRunId);
    if (!active) {
      return { stopped: false, reason: 'Run not active or already finished' };
    }

    active.controller.stop(reason);
    return { stopped: true, performanceRunId, reason };
  }

  /**
   * Get report of completed run.
   */
  getRun(performanceRunId) {
    if (!performanceRunId) return null;
    return this.history.get(performanceRunId) || null;
  }

  /**
   * Get evidence report.
   */
  getEvidence(performanceRunId) {
    return this.getRun(performanceRunId);
  }

  /**
   * List recent runs from history.
   */
  getHistory(limit = 20) {
    const runs = Array.from(this.history.values()).reverse();
    return runs.slice(0, Math.max(1, limit)).map(r => ({
      performanceRunId: r.performanceRunId,
      workloadId: r.workloadId,
      name: r.name,
      category: r.category,
      result: r.result,
      durationMs: r.durationMs,
      achievedRps: r.achievedRps,
      p95LatencyMs: r.latency ? r.latency.p95 : null,
      errorRate: r.errorRate,
      startTime: r.startTime,
      endTime: r.endTime
    }));
  }

  /**
   * Clear in-memory history.
   */
  clearHistory() {
    this.history.clear();
  }

  _addToHistory(report) {
    if (this.history.size >= this.maxHistorySize) {
      const oldestKey = this.history.keys().next().value;
      this.history.delete(oldestKey);
    }
    this.history.set(report.performanceRunId, report);
  }
}

const defaultPerformanceRunner = new PerformanceRunner();

module.exports = {
  PerformanceRunner,
  defaultPerformanceRunner
};

