/**
 * PDSChain Performance Control Plane Tests (Phase 21 - Stage C)
 * 
 * Verifies MeasurementCollector, LoadController, WorkloadContext, and PerformanceRunner.
 */

const fs = require('fs');
const {
  MeasurementCollector,
  LoadController,
  WorkloadContext,
  PerformanceRunner,
  WorkloadRegistry
} = require('../src/performance');

describe('Performance Control Plane Engine', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  describe('MeasurementCollector', () => {
    test('Calculates exact percentiles with linear interpolation', () => {
      const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      
      expect(MeasurementCollector.computePercentile([], 50)).toBe(0);
      expect(MeasurementCollector.computePercentile([42], 50)).toBe(42);
      expect(MeasurementCollector.computePercentile(samples, 0)).toBe(10);
      expect(MeasurementCollector.computePercentile(samples, 50)).toBe(55);
      expect(MeasurementCollector.computePercentile(samples, 100)).toBe(100);
      expect(MeasurementCollector.computePercentile(samples, 90)).toBe(91);
    });

    test('Records operations and computes summary statistics', async () => {
      const collector = new MeasurementCollector({ name: 'TestCollector' });
      collector.durationMs = 1000; // 1 second

      // Record 10 successful operations and 2 failed operations
      for (let i = 1; i <= 10; i++) {
        collector.recordOperation({
          operation: 'TEST_OP',
          latencyMs: i * 10,
          statusCode: 200,
          success: true
        });
      }

      collector.recordOperation({
        operation: 'TEST_OP',
        latencyMs: 150,
        statusCode: 500,
        success: false,
        errorType: 'SERVER_ERROR'
      });

      collector.recordOperation({
        operation: 'TEST_OP',
        latencyMs: 160,
        statusCode: 429,
        success: false,
        errorType: 'RATE_LIMIT'
      });

      const summary = collector.getSummary();

      expect(summary.totalRequests).toBe(12);
      expect(summary.successfulRequests).toBe(10);
      expect(summary.failedRequests).toBe(2);
      expect(summary.errorRate).toBeCloseTo(2 / 12, 3);
      expect(summary.throughputRps).toBe(12);
      expect(summary.byStatusCode['200']).toBe(10);
      expect(summary.byStatusCode['500']).toBe(1);
      expect(summary.byStatusCode['429']).toBe(1);
      expect(summary.byErrorType['SERVER_ERROR']).toBe(1);
      expect(summary.byErrorType['RATE_LIMIT']).toBe(1);

      expect(summary.latency.min).toBe(10);
      expect(summary.latency.max).toBe(160);
      expect(summary.latency.p50).toBeGreaterThan(50);
      expect(summary.latency.p95).toBeGreaterThan(100);
      expect(summary.latency.mean).toBeGreaterThan(0);
      expect(summary.latency.stdDev).toBeGreaterThan(0);
    });

    test('High-resolution timer accurately measures elapsed time', async () => {
      const collector = new MeasurementCollector();
      const endTimer = collector.startTimer('SLEEP_OP');

      await new Promise(r => setTimeout(r, 25));
      const elapsedMs = endTimer({ statusCode: 200, success: true });

      expect(elapsedMs).toBeGreaterThanOrEqual(20);
      expect(collector.latencies.length).toBe(1);
      expect(collector.latencies[0]).toBe(elapsedMs);
    });

    test('Samples runtime memory resources and stops sampling', async () => {
      const collector = new MeasurementCollector();
      collector.startResourceSampling(50);

      await new Promise(r => setTimeout(r, 120));
      collector.stopResourceSampling();

      expect(collector.resourceSamples.length).toBeGreaterThanOrEqual(2);
      const summary = collector.getSummary();
      expect(summary.resources.sampleCount).toBeGreaterThanOrEqual(2);
      expect(summary.resources.initialHeapUsedBytes).toBeGreaterThan(0);
      expect(summary.resources.peakHeapUsedBytes).toBeGreaterThan(0);
    });
  });

  describe('LoadController', () => {
    test('Paces arrival rate and respects concurrency limit', async () => {
      const controller = new LoadController({ maxConcurrency: 3 });
      let peakConcurrency = 0;
      let currentConcurrency = 0;
      let totalExecutions = 0;

      const result = await controller.executeWorkload({
        taskFn: async () => {
          currentConcurrency++;
          if (currentConcurrency > peakConcurrency) {
            peakConcurrency = currentConcurrency;
          }
          await new Promise(r => setTimeout(r, 20));
          currentConcurrency--;
          totalExecutions++;
        },
        targetRps: 50,
        concurrency: 3,
        durationMs: 200,
        warmupMs: 50,
        cooldownMs: 50
      });

      expect(result.completed).toBe(true);
      expect(result.stoppedEarly).toBe(false);
      expect(totalExecutions).toBeGreaterThan(0);
      expect(peakConcurrency).toBeLessThanOrEqual(3);
      expect(controller.currentPhase).toBe('COMPLETED');
    });

    test('Stops execution immediately upon explicit stop signal', async () => {
      const controller = new LoadController({ maxConcurrency: 5 });
      let executed = 0;

      // Start execution in background
      const executionPromise = controller.executeWorkload({
        taskFn: async () => {
          executed++;
          await new Promise(r => setTimeout(r, 30));
        },
        targetRps: 100,
        concurrency: 5,
        durationMs: 2000,
        warmupMs: 100,
        cooldownMs: 100
      });

      // Stop after 100ms
      await new Promise(r => setTimeout(r, 100));
      controller.stop('Test emergency stop');

      const result = await executionPromise;
      expect(result.stoppedEarly).toBe(true);
      expect(result.stopReason).toBe('Test emergency stop');
      expect(result.durationMs).toBeLessThan(1000);
    });
  });

  describe('WorkloadContext', () => {
    test('Initializes isolated sandbox and performs guaranteed LIFO cleanup', async () => {
      const context = new WorkloadContext({
        workloadId: 'UNIT-TEST',
        name: 'Unit Test Workload'
      });

      await context.initialize();
      expect(context.status).toBe('READY');
      expect(fs.existsSync(context.sandboxPath)).toBe(true);

      // Verify PRNG sequence determinism
      const rand1 = context.prng.random();
      const rand2 = context.prng.random();
      expect(typeof rand1).toBe('number');
      expect(typeof rand2).toBe('number');

      // Baseline snapshot
      context.captureBaseline({ ledgerHeight: 50, latestBlockHash: '0xabc' });
      expect(context.baselineSnapshot.ledgerHeight).toBe(50);

      // Cleanup hook tracking
      const cleanupOrder = [];
      context.registerCleanup(async () => {
        cleanupOrder.push('first-registered-hook');
      });
      context.registerCleanup(async () => {
        cleanupOrder.push('second-registered-hook');
      });

      // Post-run snapshot
      context.capturePostRun({ ledgerHeight: 50, latestBlockHash: '0xabc' });
      expect(context.postRunSnapshot.ledgerHeight).toBe(50);

      await context.cleanup();

      // Verify LIFO hook execution
      expect(cleanupOrder).toEqual(['second-registered-hook', 'first-registered-hook']);
      // Verify sandbox removal
      expect(fs.existsSync(context.sandboxPath)).toBe(false);
      expect(context.cleanedUp).toBe(true);
    });
  });

  describe('PerformanceRunner', () => {
    test('Executes end-to-end workload and tracks history', async () => {
      const runner = new PerformanceRunner();
      const customWorkload = {
        id: 'CUSTOM-001',
        name: 'Custom Synthetic Workload',
        category: 'GENERAL',
        targetRps: 50,
        concurrency: 2,
        durationMs: 300,
        warmupMs: 50,
        cooldownMs: 50,
        slo: { maxP95LatencyMs: 100, maxErrorRate: 0.05 },
        taskFn: async (ctx, workerId) => {
          const timer = ctx.collector.startTimer('CUSTOM_TASK');
          await new Promise(r => setTimeout(r, 5));
          timer({ statusCode: 200, success: true });
        }
      };

      const report = await runner.runWorkload(customWorkload, {
        durationMs: 300,
        concurrency: 2,
        targetRps: 50
      });

      expect(report.workloadId).toBe('CUSTOM-001');
      expect(report.result).toBe('PASSED');
      expect(report.totalRequests).toBeGreaterThan(0);
      expect(report.successfulRequests).toBe(report.totalRequests);
      expect(report.failedRequests).toBe(0);
      expect(report.errorRate).toBe(0);
      expect(report.latency.p95).toBeLessThan(100);
      expect(report.cleanedUp).toBe(true);
      expect(report.invariantResults.every(inv => inv.passed)).toBe(true);
      expect(report.sloResults.every(slo => slo.passed)).toBe(true);

      // Verify history tracking
      const history = runner.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].performanceRunId).toBe(report.performanceRunId);

      const retrievedReport = runner.getRun(report.performanceRunId);
      expect(retrievedReport).toBeDefined();
      expect(retrievedReport.performanceRunId).toBe(report.performanceRunId);
    });

    test('Can stop an active performance run via runner', async () => {
      const runner = new PerformanceRunner();
      const longWorkload = {
        id: 'LONG-001',
        name: 'Long Running Workload',
        category: 'GENERAL',
        durationMs: 5000,
        concurrency: 2,
        targetRps: 10,
        taskFn: async (ctx) => {
          const timer = ctx.collector.startTimer('LONG_TASK');
          await new Promise(r => setTimeout(r, 50));
          timer({ statusCode: 200, success: true });
        }
      };

      let runPromise = runner.runWorkload(longWorkload, { durationMs: 5000 });

      // Wait 150ms and find active run
      await new Promise(r => setTimeout(r, 150));
      expect(runner.activeRuns.size).toBe(1);
      const activeRunId = runner.activeRuns.keys().next().value;

      const stopResult = runner.stopRun(activeRunId, 'Test manual abort');
      expect(stopResult.stopped).toBe(true);

      const report = await runPromise;
      expect(report.performanceRunId).toBe(activeRunId);
      expect(report.durationMs).toBeLessThan(2000);
    });
  });
});

