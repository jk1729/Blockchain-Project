/**
 * PDSChain Simulation REST APIs (Phase 20 - Stage P)
 * 
 * Provides controlled execution and evidence query endpoints for attack and failure simulations.
 * Gated strictly behind SIMULATION_MODE=true and canonical RBAC permissions.
 */

const express = require('express');
const router = express.Router();
const {
  SafetyGuard,
  defaultScenarioRegistry,
  defaultSimulationRunner
} = require('../../simulation');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../security/permissions/permissionMiddleware');

/**
 * Middleware: Refuse all simulation API access if SIMULATION_MODE is not active.
 */
function simulationModeGuard(req, res, next) {
  if (!SafetyGuard.isSimulationModeActive()) {
    return res.status(403).json({
      success: false,
      error: {
        code: 'E_SIMULATION_MODE_DISABLED',
        message: 'Simulation APIs are strictly disabled outside simulation mode (SIMULATION_MODE=true required)'
      }
    });
  }
  next();
}

router.use(simulationModeGuard);

/**
 * GET /api/v1/simulations/scenarios
 * List all registered simulation scenarios and catalog metadata.
 */
router.get('/scenarios', authMiddleware, requirePermission('simulation:read:scenarios'), (req, res) => {
  const category = req.query.category;
  const scenarios = category
    ? defaultScenarioRegistry.getByCategory(category).map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        severity: s.severity,
        description: s.description,
        runtimeBudgetMs: s.runtimeBudgetMs,
        expectedOutcome: s.expectedOutcome,
        invariants: s.invariants
      }))
    : defaultScenarioRegistry.list();

  return res.json({
    success: true,
    data: {
      total: scenarios.length,
      scenarios
    },
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * POST /api/v1/simulations/run
 * Execute a controlled simulation scenario.
 */
router.post('/run', authMiddleware, requirePermission('simulation:run:scenario'), async (req, res) => {
  const { scenarioId, seed, parameters, timeoutMs } = req.body || {};

  if (!scenarioId || typeof scenarioId !== 'string') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'E_INVALID_PARAMETER',
        message: 'Missing or invalid required body parameter "scenarioId"'
      }
    });
  }

  if (!defaultScenarioRegistry.has(scenarioId)) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_SCENARIO_NOT_FOUND',
        message: `Scenario "${scenarioId}" does not exist in registry`
      }
    });
  }

  try {
    const evidence = await defaultSimulationRunner.runScenario(scenarioId, {
      seed,
      parameters,
      timeoutMs: timeoutMs ? parseInt(timeoutMs, 10) : undefined
    });

    const httpStatus = evidence.result === 'PASSED' ? 200 : 500;
    return res.status(httpStatus).json({
      success: evidence.result === 'PASSED',
      data: evidence,
      meta: { timestamp: new Date().toISOString() }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: {
        code: err.code || 'E_SIMULATION_EXECUTION_FAILED',
        message: err.message
      }
    });
  }
});

/**
 * GET /api/v1/simulations/history
 * List historical simulation runs from ring-buffer.
 */
router.get('/history', authMiddleware, requirePermission('simulation:read:evidence'), (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const history = defaultSimulationRunner.getHistory(limit);

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
 * GET /api/v1/simulations/:simulationId
 * Retrieve execution status of a simulation.
 */
router.get('/:simulationId', authMiddleware, requirePermission('simulation:read:evidence'), (req, res) => {
  const { simulationId } = req.params;
  const sim = defaultSimulationRunner.getSimulation(simulationId);

  if (!sim) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_SIMULATION_NOT_FOUND',
        message: `Simulation "${simulationId}" not found in history or active runs`
      }
    });
  }

  return res.json({
    success: true,
    data: sim,
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * POST /api/v1/simulations/:simulationId/stop
 * Trigger emergency stop or cancellation of an active simulation.
 */
router.post('/:simulationId/stop', authMiddleware, requirePermission('simulation:stop:scenario'), (req, res) => {
  const { simulationId } = req.params;
  const { reason } = req.body || {};

  const result = defaultSimulationRunner.stopSimulation(simulationId, reason || 'Operator request');

  return res.json({
    success: result.stopped,
    data: result,
    meta: { timestamp: new Date().toISOString() }
  });
});

/**
 * GET /api/v1/simulations/:simulationId/evidence
 * Retrieve full evidence report for a simulation.
 */
router.get('/:simulationId/evidence', authMiddleware, requirePermission('simulation:read:evidence'), (req, res) => {
  const { simulationId } = req.params;
  const evidence = defaultSimulationRunner.getEvidence(simulationId);

  if (!evidence) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'E_EVIDENCE_NOT_FOUND',
        message: `Evidence report for simulation "${simulationId}" not found`
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

