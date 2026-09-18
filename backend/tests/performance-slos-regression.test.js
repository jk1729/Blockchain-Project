/**
 * PDSChain Performance SLO & Regression Detection Tests (Phase 21 - Stage M, P)
 * 
 * Verifies PerformanceReport generation, SLO compliance classification,
 * and automated baseline regression comparison (latency degradation and throughput drops).
 */

const {
  WorkloadContext,
  PerformanceReport
} = require('../src/performance');

describe('Performance SLOs and Regression Detection Engine', () => {
  let mockContext;

  beforeEach(() => {
    mockContext = new WorkloadContext({
      workloadId: 'SLO-TEST',
      name: 'SLO Test Workload',
      category: 'TEST'
    });

    // Record 100 fast successful operations
    for (let i = 0; i < 100; i++) {
      mockContext.collector.recordOperation({
        operation: 'FAST_OP',
        latencyMs: 10 + (i % 5),
        statusCode: 200,
        success: true
      });
    }
  });

  describe('PerformanceReport Generation & SLO Evaluation', () => {
    test('Evaluates passing report when within all SLO limits', () => {
      const report = PerformanceReport.generate(mockContext, {
        targetRps: 100,
        sloResults: [
          { target: 'maxP95LatencyMs', threshold: 50, achieved: 14, passed: true }
        ],
        invariantResults: [
          { invariant: 'assertMonotonicHeight', passed: true }
        ]
      });

      expect(report.result).toBe('PASSED');
      expect(report.totalRequests).toBe(100);
      expect(report.errorRate).toBe(0);
      expect(report.latency.p95).toBeLessThan(50);
    });

    test('Flags FAILED_SLO when latency threshold is violated', () => {
      const report = PerformanceReport.generate(mockContext, {
        sloResults: [
          { target: 'maxP95LatencyMs', threshold: 10, achieved: 14, passed: false }
        ]
      });

      expect(report.result).toBe('FAILED_SLO');
    });

    test('Flags FAILED_ERROR_RATE when error rate exceeds threshold', () => {
      // Add 20 failures
      for (let i = 0; i < 20; i++) {
        mockContext.collector.recordOperation({
          operation: 'FAIL_OP',
          latencyMs: 15,
          statusCode: 500,
          success: false
        });
      }

      const report = PerformanceReport.generate(mockContext, {
        maxAllowedErrorRate: 0.05
      });

      expect(report.errorRate).toBeGreaterThan(0.05);
      expect(report.result).toBe('FAILED_ERROR_RATE');
    });

    test('Flags FAILED_INVARIANT when invariant assertion fails', () => {
      const report = PerformanceReport.generate(mockContext, {
        invariantResults: [
          { invariant: 'assertMonotonicHeight', passed: false, error: 'Height regressed' }
        ]
      });

      expect(report.result).toBe('FAILED_INVARIANT');
    });
  });

  describe('PerformanceReport Automated Regression Comparison', () => {
    const baselineReport = {
      performanceRunId: 'base-001',
      achievedRps: 100,
      latency: { p50: 10, p90: 20, p95: 25, p99: 30 }
    };

    test('Detects no regression when performance is within tolerances', () => {
      const currentReport = {
        achievedRps: 98,
        latency: { p95: 26 }
      };

      const comparison = PerformanceReport.compare(currentReport, baselineReport);
      expect(comparison.hasRegression).toBe(false);
      expect(comparison.flags.length).toBe(0);
      expect(comparison.latencyDeltaPct).toBeCloseTo(4, 0);
      expect(comparison.throughputDeltaPct).toBeCloseTo(2, 0);
    });

    test('Detects latency degradation regression exceeding 20%', () => {
      const currentReport = {
        achievedRps: 100,
        latency: { p95: 35 } // 40% increase over 25ms baseline
      };

      const comparison = PerformanceReport.compare(currentReport, baselineReport);
      expect(comparison.hasRegression).toBe(true);
      expect(comparison.flags.length).toBe(1);
      expect(comparison.flags[0]).toMatch(/p95 latency degraded by 40%/);
    });

    test('Detects throughput drop regression exceeding 15%', () => {
      const currentReport = {
        achievedRps: 80, // 20% drop from 100 RPS baseline
        latency: { p95: 25 }
      };

      const comparison = PerformanceReport.compare(currentReport, baselineReport);
      expect(comparison.hasRegression).toBe(true);
      expect(comparison.flags.length).toBe(1);
      expect(comparison.flags[0]).toMatch(/throughput dropped by 20%/);
    });

    test('Respects custom regression tolerances', () => {
      const currentReport = {
        achievedRps: 92, // 8% drop
        latency: { p95: 27.5 } // 10% increase
      };

      // Tolerances set strictly to 5%
      const comparison = PerformanceReport.compare(currentReport, baselineReport, {
        maxLatencyDegradationPct: 5,
        maxThroughputDropPct: 5
      });

      expect(comparison.hasRegression).toBe(true);
      expect(comparison.flags.length).toBe(2);
    });
  });
});

