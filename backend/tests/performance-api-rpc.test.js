/**
 * PDSChain API & JSON-RPC Performance Tests (Phase 21 - Stage E)
 * 
 * Executes workloads:
 * - API-001: Citizen Ration & Beneficiary Lookup
 * - API-002: Shop Inventory & Commodity Availability Query
 * Validates concurrency handling, p95 latency targets, and zero degradation.
 */

const { defaultPerformanceRunner } = require('../src/performance');

describe('API & JSON-RPC Performance Workloads', () => {
  beforeAll(() => {
    process.env.PERFORMANCE_TEST_MODE = 'true';
    process.env.NODE_ENV = 'test';
  });

  test('API-001: Executes Citizen Ration & Beneficiary Lookup within SLO limits', async () => {
    const report = await defaultPerformanceRunner.runWorkload('API-001', {
      durationMs: 400,
      concurrency: 6,
      targetRps: 60,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('API-001');
    expect(report.category).toBe('API_PUBLIC_DISTRIBUTION');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.errorRate).toBe(0);
    expect(report.byStatusCode['200']).toBe(report.totalRequests);

    // SLO validation
    expect(report.latency.p95).toBeLessThanOrEqual(100);
    expect(report.sloResults.length).toBe(2);
    expect(report.sloResults.every(s => s.passed)).toBe(true);

    // Invariant validation
    expect(report.invariantResults.every(i => i.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });

  test('API-002: Executes Shop Inventory & Commodity Availability within SLO limits', async () => {
    const report = await defaultPerformanceRunner.runWorkload('API-002', {
      durationMs: 400,
      concurrency: 5,
      targetRps: 50,
      warmupMs: 50,
      cooldownMs: 50
    });

    expect(report.workloadId).toBe('API-002');
    expect(report.category).toBe('API_PUBLIC_DISTRIBUTION');
    expect(report.result).toBe('PASSED');
    expect(report.totalRequests).toBeGreaterThan(0);
    expect(report.errorRate).toBe(0);
    expect(report.byStatusCode['200']).toBe(report.totalRequests);

    // SLO validation
    expect(report.latency.p95).toBeLessThanOrEqual(120);
    expect(report.sloResults.every(s => s.passed)).toBe(true);
    expect(report.cleanedUp).toBe(true);
  });
});

