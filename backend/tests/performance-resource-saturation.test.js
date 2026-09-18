/**
 * PDSChain Resource Saturation & Backpressure Tests (Phase 21 - Stage J)
 * 
 * Executes workload:
 * - RES-001: Mempool Saturation & Backpressure Enforcement
 * Evaluates behavior under queue saturation, 429 rate limit backpressure, and resource recovery.
 */

const { defaultPerformanceRunner } = require('../src/performance');

describe('Resource Saturation Performance Workloads', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('RES-001: Enforces backpressure and rejects overflow with 429 status', async () => {
    const report = await defaultPerformanceRunner.runWorkload('RES-001', {
      durationMs: 400,
      concurrency: 10,
      targetRps: 100,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('RES-001');
    expect(report.category).toBe('RESOURCE_SATURATION');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);

    // Verify backpressure enforcement
    expect(report.byStatusCode['200']).toBeGreaterThan(0);
    expect(report.byStatusCode['429']).toBeGreaterThan(0);
    expect(report.byErrorType['MEMPOOL_FULL']).toBeGreaterThan(0);

    // Error rate within defined burst SLO threshold of 0.40
    expect(report.errorRate).toBeLessThanOrEqual(0.40);
    expect(report.latency.p95).toBeLessThanOrEqual(150);
    expect(report.sloResults.every(s => s.passed)).toBe(true);

    // Resource tracking check
    expect(report.resources.sampleCount).toBeGreaterThan(0);
    expect(report.resources.peakHeapUsedBytes).toBeGreaterThan(0);

    // Invariant checks & clean up
    expect(report.invariantResults.every(inv => inv.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });
});

