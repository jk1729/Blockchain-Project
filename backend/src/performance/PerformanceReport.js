/**
 * PDSChain Performance Report Generator (Phase 21 - Stage B, P)
 * 
 * Compiles auditable, tamper-evident performance reports, evaluates SLO compliance,
 * and performs automated baseline comparison to detect performance regressions.
 */

class PerformanceReport {
  /**
   * Assemble complete performance report from context and measurement summary.
   */
  static generate(context, options = {}) {
    const summary = context.collector.getSummary();
    const sloResults = options.sloResults || [];
    const invariantResults = options.invariantResults || [];
    const baselineComparison = options.baselineComparison || null;

    let overallResult = 'PASSED';
    if (summary.errorRate > (options.maxAllowedErrorRate || 0.05)) {
      overallResult = 'FAILED_ERROR_RATE';
    } else if (invariantResults.some(inv => !inv.passed)) {
      overallResult = 'FAILED_INVARIANT';
    } else if (sloResults.some(slo => !slo.passed)) {
      overallResult = 'FAILED_SLO';
    } else if (baselineComparison && baselineComparison.hasRegression) {
      overallResult = 'FAILED_REGRESSION';
    }

    return {
      performanceRunId: context.performanceRunId,
      workloadId: context.workloadId,
      name: context.name,
      category: context.category,
      seed: context.seed,
      result: overallResult,
      status: context.status,
      startTime: context.startTime ? new Date(context.startTime).toISOString() : null,
      endTime: context.endTime ? new Date(context.endTime).toISOString() : null,
      durationMs: context.durationMs,
      targetRps: options.targetRps || 0,
      achievedRps: summary.throughputRps,
      concurrency: options.concurrency || 1,
      totalRequests: summary.totalRequests,
      successfulRequests: summary.successfulRequests,
      failedRequests: summary.failedRequests,
      errorRate: summary.errorRate,
      latency: summary.latency,
      byStatusCode: summary.byStatusCode,
      byErrorType: summary.byErrorType,
      resources: summary.resources,
      baselineSnapshot: context.baselineSnapshot,
      postRunSnapshot: context.postRunSnapshot,
      sloResults,
      invariantResults,
      baselineComparison,
      cleanedUp: context.cleanedUp
    };
  }

  /**
   * Compare a current report against a reference baseline report.
   * 
   * @param {object} current - Current benchmark report
   * @param {object} baseline - Reference baseline benchmark report
   * @param {object} [tolerances]
   * @param {number} [tolerances.maxLatencyDegradationPct=20] - Max allowable p95 increase
   * @param {number} [tolerances.maxThroughputDropPct=15] - Max allowable throughput drop
   */
  static compare(current, baseline, tolerances = {}) {
    if (!current || !baseline) return null;

    const maxLatencyDegradationPct = tolerances.maxLatencyDegradationPct || 20;
    const maxThroughputDropPct = tolerances.maxThroughputDropPct || 15;

    const curP95 = current.latency ? current.latency.p95 : 0;
    const baseP95 = baseline.latency ? baseline.latency.p95 : 0;

    let latencyDeltaPct = 0;
    if (baseP95 > 0) {
      latencyDeltaPct = Number((((curP95 - baseP95) / baseP95) * 100).toFixed(2));
    }

    const curRps = current.achievedRps || 0;
    const baseRps = baseline.achievedRps || 0;

    let throughputDeltaPct = 0;
    if (baseRps > 0) {
      throughputDeltaPct = Number((((baseRps - curRps) / baseRps) * 100).toFixed(2));
    }

    const flags = [];
    if (latencyDeltaPct > maxLatencyDegradationPct) {
      flags.push(`p95 latency degraded by ${latencyDeltaPct}% (threshold: ${maxLatencyDegradationPct}%)`);
    }
    if (throughputDeltaPct > maxThroughputDropPct) {
      flags.push(`throughput dropped by ${throughputDeltaPct}% (threshold: ${maxThroughputDropPct}%)`);
    }

    return {
      hasRegression: flags.length > 0,
      baselineRunId: baseline.performanceRunId,
      currentP95Ms: curP95,
      baselineP95Ms: baseP95,
      latencyDeltaPct,
      currentRps: curRps,
      baselineRps: baseRps,
      throughputDeltaPct,
      flags
    };
  }
}

module.exports = { PerformanceReport };

