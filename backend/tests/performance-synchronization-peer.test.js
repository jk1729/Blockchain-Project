/**
 * PDSChain Synchronization & Networking Performance Tests (Phase 21 - Stage I)
 * 
 * Executes workload:
 * - SYNC-001: Fast Block Synchronization Catch-Up
 * Evaluates block streaming batch latency, network throughput, and peer sync pacing.
 */

const { defaultPerformanceRunner } = require('../src/performance');

describe('Synchronization & Networking Performance Workloads', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('SYNC-001: Measures fast block synchronization batch streaming throughput', async () => {
    const report = await defaultPerformanceRunner.runWorkload('SYNC-001', {
      durationMs: 400,
      concurrency: 4,
      targetRps: 40,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('SYNC-001');
    expect(report.category).toBe('SYNC_NETWORKING');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.errorRate).toBe(0);
    expect(report.byStatusCode['200']).toBe(report.totalRequests);

    // Latency & SLO validation
    expect(report.latency.p95).toBeLessThanOrEqual(180);
    expect(report.sloResults.every(s => s.passed)).toBe(true);

    // Invariant integrity checks
    expect(report.invariantResults.every(inv => inv.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });
});

