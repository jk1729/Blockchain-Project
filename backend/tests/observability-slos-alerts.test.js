/**
 * Phase 19: SLOs, Error Budgets & Alert Rules Test Suite
 */

const { SloEngine, DEFAULT_SLOS } = require('../src/observability/SloEngine');
const { AlertManager, ALERT_RULES } = require('../src/observability/AlertManager');

describe('Phase 19: SLOs, Error Budgets & Alert Rules', () => {
  describe('1. SLO & Error Budget Calculations', () => {
    let engine;

    beforeEach(() => {
      engine = new SloEngine();
    });

    test('should correctly compute compliance when SLI meets target', () => {
      // 1000 requests, 1000 good -> 100.0% (HEALTHY)
      const resHealthy = engine.evaluateSlo('api_availability', 1000, 1000);
      expect(resHealthy.measuredPercent).toBe(100.0);
      expect(resHealthy.isMet).toBe(true);
      expect(resHealthy.status).toBe('HEALTHY');
      expect(resHealthy.consumedBudgetPercent).toBe(0.0);

      // 1000 requests, 999 good -> 99.9% (met, but consumed 100% of budget -> WARNING)
      const resWarning = engine.evaluateSlo('api_availability', 1000, 999);
      expect(resWarning.measuredPercent).toBe(99.9);
      expect(resWarning.isMet).toBe(true);
      expect(resWarning.status).toBe('WARNING');
      expect(resWarning.consumedBudgetPercent).toBeCloseTo(100.0, 1);
    });

    test('should flag BREACHED when measured rate falls below target', () => {
      // 1000 requests, 990 good -> 99.0% (target is 99.9%)
      const res = engine.evaluateSlo('api_availability', 1000, 990);
      expect(res.measuredPercent).toBe(99.0);
      expect(res.isMet).toBe(false);
      expect(res.status).toBe('BREACHED');
      expect(res.consumedBudgetPercent).toBeGreaterThan(100);
      expect(res.remainingBudgetPercent).toBe(0);
    });

    test('evaluateAll should evaluate all registered SLO targets', () => {
      const all = engine.evaluateAll();
      expect(all.length).toBe(DEFAULT_SLOS.length);
      expect(all.every(s => s.name && s.category)).toBe(true);
    });
  });

  describe('2. Alert Manager & Rule Evaluation', () => {
    let alertManager;

    beforeEach(() => {
      alertManager = new AlertManager();
    });

    test('should evaluate all alerts as OK when metrics are within healthy limits', () => {
      const cleanMetrics = {
        httpErrorsTotal: 0,
        consensusRoundTimeouts: 0,
        poolActiveConnections: 5,
        poolMaxConnections: 20,
        integrityErrorsTotal: 0,
        breakGlassActivations: 0,
        heapUsedBytes: 500 * 1024 * 1024,
        eventLoopLagSeconds: 0.01
      };

      const alerts = alertManager.evaluate(cleanMetrics);
      expect(alerts.every(a => a.status === 'OK')).toBe(true);
      expect(alertManager.getFiringAlerts(cleanMetrics).length).toBe(0);
    });

    test('should trigger FIRING when thresholds are breached', () => {
      const failingMetrics = {
        httpErrorsTotal: 35, // HighHttp5xxRate > 20
        consensusRoundTimeouts: 6, // ConsensusStalled > 5
        poolActiveConnections: 20, // DatabasePoolExhausted
        poolMaxConnections: 20,
        integrityErrorsTotal: 1, // DatabaseIntegrityFailure
        breakGlassActivations: 1
      };

      const firing = alertManager.getFiringAlerts(failingMetrics);
      const firingIds = firing.map(f => f.id);

      expect(firingIds).toContain('HighHttp5xxRate');
      expect(firingIds).toContain('ConsensusStalled');
      expect(firingIds).toContain('DatabasePoolExhausted');
      expect(firingIds).toContain('DatabaseIntegrityFailure');
      expect(firingIds).toContain('BreakGlassEmergencyActivated');
    });
  });
});
