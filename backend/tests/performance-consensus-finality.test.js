/**
 * PDSChain Consensus & Finality Performance Tests (Phase 21 - Stage G)
 * 
 * Executes workload:
 * - CONS-001: Consensus Round Finalization Throughput
 * Measures round execution, vote processing, and block finalization latency.
 */

const { defaultPerformanceRunner } = require('../src/performance');

describe('Consensus & Finality Performance Workloads', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('CONS-001: Measures consensus round execution and vote processing throughput', async () => {
    const report = await defaultPerformanceRunner.runWorkload('CONS-001', {
      durationMs: 400,
      concurrency: 4,
      targetRps: 40,
      warmupMs: 50,
      cooldownMs: 50,
      baselineHeight: 500,
      postHeight: 500
    });

    expect(report.workloadId).toBe('CONS-001');
    expect(report.category).toBe('CONSENSUS_FINALITY');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.errorRate).toBe(0);
    expect(report.byStatusCode['200']).toBe(report.totalRequests);

    // Latency & SLO verification
    expect(report.latency.p95).toBeLessThanOrEqual(200);
    expect(report.sloResults.every(s => s.passed)).toBe(true);

    // Invariant integrity checks
    expect(report.invariantResults.every(inv => inv.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });
});

