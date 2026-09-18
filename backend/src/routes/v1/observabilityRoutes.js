/**
 * PDSChain Observability REST APIs (Phase 19)
 * 
 * Provides endpoints for unified Prometheus metrics scraping, health/status diagnostics,
 * sanitized configuration review, real-time SLO evaluation, and active alert queries.
 */

const express = require('express');
const router = express.Router();
const {
  defaultMetricsRegistry,
  defaultHealthManager,
  defaultObservabilityConfig,
  defaultSloEngine,
  defaultAlertManager,
  defaultDatabaseMetrics
} = require('../../observability');
const { authMiddleware } = require('../../middleware/authMiddleware');
const { requirePermission } = require('../../security/permissions/permissionMiddleware');

/**
 * Public or operator Prometheus scrape endpoint
 * GET /api/v1/observability/metrics
 */
router.get('/metrics', (req, res) => {
  if (req.query.format === 'json' || req.headers.accept === 'application/json') {
    return res.json({
      success: true,
      data: defaultMetricsRegistry.getMetricsSnapshot(),
      meta: { finality: 'FINALIZED', timestamp: new Date().toISOString() }
    });
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return res.send(defaultMetricsRegistry.exportPrometheusText());
});

/**
 * Node health & subsystem status diagnostics
 * GET /api/v1/observability/status
 */
router.get('/status', authMiddleware, requirePermission('operator:read:node-status'), async (req, res) => {
  const health = await defaultHealthManager.getAggregateHealth();
  return res.status(health.statusCode).json({
    success: health.statusCode === 200,
    data: health.payload,
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Sanitized observability configuration
 * GET /api/v1/observability/config
 */
router.get('/config', authMiddleware, requirePermission('operator:read:node-status'), (req, res) => {
  return res.json({
    success: true,
    data: defaultObservabilityConfig.getSanitized(),
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Real-time SLO & error budget evaluation
 * GET /api/v1/observability/slo
 */
router.get('/slo', authMiddleware, requirePermission('operator:read:metrics'), (req, res) => {
  const evaluations = defaultSloEngine.evaluateAll();
  return res.json({
    success: true,
    data: {
      slos: evaluations,
      overallMet: evaluations.every(s => s.isMet),
      evaluatedAt: new Date().toISOString()
    },
    meta: { finality: 'FINALIZED' }
  });
});

/**
 * Active and firing alert states
 * GET /api/v1/observability/alerts
 */
router.get('/alerts', authMiddleware, requirePermission('operator:read:metrics'), (req, res) => {
  const alerts = defaultAlertManager.evaluate();
  const firingCount = alerts.filter(a => a.status === 'FIRING').length;
  return res.json({
    success: true,
    data: {
      alertCount: alerts.length,
      firingCount,
      alerts
    },
    meta: { finality: 'FINALIZED' }
  });
});

module.exports = router;

