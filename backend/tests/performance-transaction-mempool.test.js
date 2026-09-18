/**
 * PDSChain Transaction & Mempool Performance Tests (Phase 21 - Stage F)
 * 
 * Executes workloads:
 * - TX-001: Ration Distribution Transaction Burst
 * - TX-002: Mixed Valid and Invalid Transaction Stream
 * Validates cryptographic transaction admission, signature rejection, and mempool throughput.
 */

const { defaultPerformanceRunner } = require('../src/performance');

describe('Transaction & Mempool Performance Workloads', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('TX-001: Submits transaction burst and measures mempool throughput', async () => {
    const report = await defaultPerformanceRunner.runWorkload('TX-001', {
      durationMs: 400,
      concurrency: 5,
      targetRps: 60,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('TX-001');
    expect(report.category).toBe('BLOCKCHAIN_TRANSACTIONS');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.errorRate).toBe(0);
    expect(report.latency.p95).toBeLessThanOrEqual(150);
    expect(report.sloResults.every(s => s.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });

  test('TX-002: Handles mixed valid/invalid transaction stream and classifies errors', async () => {
    const report = await defaultPerformanceRunner.runWorkload('TX-002', {
      durationMs: 400,
      concurrency: 6,
      targetRps: 80,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('TX-002');
    expect(report.category).toBe('BLOCKCHAIN_TRANSACTIONS');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);

    // Verify error classification
    expect(report.byStatusCode['200']).toBeGreaterThan(0);
    expect(report.byStatusCode['400']).toBeGreaterThan(0);
    expect(report.byErrorType['INVALID_SIGNATURE']).toBeGreaterThan(0);

    // Expected ~20% rejection rate, within SLO threshold of 0.25
    expect(report.errorRate).toBeGreaterThan(0);
    expect(report.errorRate).toBeLessThanOrEqual(0.25);
    expect(report.sloResults.every(s => s.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });
});

