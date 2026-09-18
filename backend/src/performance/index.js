/**
 * PDSChain Performance Module (Phase 21)
 * 
 * Aggregates and exports all performance testing components:
 * - MeasurementCollector: High-resolution timing & percentiles (p50-p99, max)
 * - LoadController: Pacing, concurrency, warmup, cooldown
 * - WorkloadContext: Sandboxed execution lifecycle & PRNG
 * - WorkloadRegistry: Catalog of benchmark workloads across 6 domains
 * - PerformanceReport: Report generation & baseline regression analysis
 * - PerformanceRunner: 13-step lifecycle orchestrator
 */

const { MeasurementCollector } = require('./MeasurementCollector');
const { LoadController } = require('./LoadController');
const { WorkloadContext } = require('./WorkloadContext');
const { WorkloadRegistry, defaultWorkloadRegistry } = require('./WorkloadRegistry');
const { PerformanceReport } = require('./PerformanceReport');
const { PerformanceRunner, defaultPerformanceRunner } = require('./PerformanceRunner');

module.exports = {
  MeasurementCollector,
  LoadController,
  WorkloadContext,
  WorkloadRegistry,
  defaultWorkloadRegistry,
  PerformanceReport,
  PerformanceRunner,
  defaultPerformanceRunner
};

