/**
 * PDSChain Performance REST APIs (Phase 21 - Stage O)
 * 
 * Provides controlled execution and evidence query endpoints for performance and load tests.
 * Gated strictly behind PERFORMANCE_TEST_MODE=true (or SIMULATION_MODE=true) and canonical RBAC permissions.
 */

const express = require('express');
const router = express.Router();
const {
  defaultWorkloadRegistry,
  defaultPerformanceRunner
} = require('../../performance');
const { SafetyGuard } = require('../../simulation/SafetyGuard');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../security/permissions/permissionMiddleware');

/**
 * Middleware: Refuse all performance API access if PERFORMANCE_TEST_MODE is not active.
 */
function performanceModeGuard(req, res, next) {
  if (!SafetyGuard.isPerformanceModeActive()) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'E_PERFORMANCE_MODE_DISABLED',
        message: 'Performance APIs are strictly disabled outside performance test mode (PERFORMANCE_TEST_MODE=true required)'
      }
    });
  }
  next();
}

router.use(performanceModeGuard);

/**
 * GET /api/v1/performance/workloads
 * List all registered performance testing workloads and metadata.
 */
router.get('/workloads', authMiddleware, requirePermission('performance:read:workloads'), (req, res) => {
  const category = req.query.category;
  const workloads = category
    ? defaultWorkloadRegistry.getByCategory(category).map(w => ({
        id: w.id,
        name: w.name,
        category: w.category,
        description: w.description,
        targetRps: w.targetRps,
        concurrency: w.concurrency,
        durationMs: w.durationMs,
        slo: w.slo
      }))
    : defaultWorkloadRegistry.list();

  return res.json({
    success: true,
    data: {
      total: workloads.length,
      workloads
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * POST /api/v1/performance/runs
 * Execute a controlled performance benchmark.
 */
router.post('/runs', authMiddleware, requirePermission('performance:run:workload'), async (req, res) => {
  const { workloadId, seed, durationMs, concurrency, targetRps, parameters } = req.body || {};

  if (!workloadId || typeof workloadId !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'E_INVALID_PARAMETER',
        message: 'Missing or invalid required body parameter "workloadId"'
      }
    });
  }

  if (!defaultWorkloadRegistry.has(workloadId)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_WORKLOAD_NOT_FOUND',
        message: `Workload "${workloadId}" does not exist in WorkloadRegistry`
      }
    });
  }

  try {
    const report = await defaultPerformanceRunner.runWorkload(workloadId, {
      seed,
      durationMs: durationMs ? parseInt(durationMs, 10) : undefined,
      concurrency: concurrency ? parseInt(concurrency, 10) : undefined,
      targetRps: targetRps ? parseInt(targetRps, 10) : undefined,
      parameters
    });

    const httpStatus = report.result === 'PASSED' ? 200 : 500;
    return res.status(httpStatus).json({
      success: report.result === 'PASSED',
      data: report,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: err.code || 'E_PERFORMANCE_RUN_FAILED',
        message: err.message
      }
    });
  }
});

/**
 * GET /api/v1/performance/history
 * List historical performance benchmark runs from ring-buffer.
 */
router.get('/history', authMiddleware, requirePermission('performance:read:evidence'), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const history = defaultPerformanceRunner.getHistory(limit);

  return res.json({
    success: true,
    data: {
      total: history.length,
      history
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * GET /api/v1/performance/runs/:performanceRunId
 * Retrieve execution status and summary of a benchmark run.
 */
router.get('/runs/:performanceRunId', authMiddleware, requirePermission('performance:read:evidence'), (req, res) => {
  const { performanceRunId } = req.params;
  const run = defaultPerformanceRunner.getRun(performanceRunId);

  if (!run) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_RUN_NOT_FOUND',
        message: `Performance run "${performanceRunId}" not found in history or active runs`
      }
    });
  }

  return res.json({
    success: true,
    data: run,
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * POST /api/v1/performance/runs/:performanceRunId/stop
 * Trigger stop or cancellation of an active performance run.
 */
router.post('/runs/:performanceRunId/stop', authMiddleware, requirePermission('performance:stop:run'), (req, res) => {
  const { performanceRunId } = req.params;
  const { reason } = req.body || {};

  const result = defaultPerformanceRunner.stopRun(performanceRunId, reason || 'Operator request');

  return res.json({
    success: result.stopped,
    data: result,
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * GET /api/v1/performance/runs/:performanceRunId/evidence
 * Retrieve full evidence report for a performance run.
 */
router.get('/runs/:performanceRunId/evidence', authMiddleware, requirePermission('performance:read:evidence'), (req, res) => {
  const { performanceRunId } = req.params;
  const evidence = defaultPerformanceRunner.getEvidence(performanceRunId);

  if (!evidence) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_EVIDENCE_NOT_FOUND',
        message: `Evidence report for performance run "${performanceRunId}" not found`
      }
    });
  }

  return res.json({
    success: true,
    data: evidence,
    meta: { timestamp: new Date().toISOString() }
  });
});

module.exports = router;

