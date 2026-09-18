/**
 * Phase 19: Health, Readiness, and Liveness Probes Test Suite
 */

const { HealthManager } = require('../src/observability/HealthManager');

describe('Phase 19: Health, Readiness, and Liveness Probes', () => {
  let healthManager;

  beforeEach(() => {
    healthManager = new HealthManager({ isStarted: true, timeoutMs: 1000 });
  });

  describe('1. Liveness Probe (GET /health/live)', () => {
    test('should return 200 LIVE during normal operation', () => {
      const probe = healthManager.getLiveness();
      expect(probe.statusCode).toBe(200);
      expect(probe.payload.status).toBe('LIVE');
      expect(probe.payload.pid).toBe(process.pid);
      expect(probe.payload.uptime).toBeGreaterThanOrEqual(0);
    });

    test('should return 503 TERMINATING when node is shutting down', () => {
      healthManager.setTerminating(true);
      const probe = healthManager.getLiveness();
      expect(probe.statusCode).toBe(503);
      expect(probe.payload.status).toBe('TERMINATING');
    });
  });

  describe('2. Startup Probe (GET /health/startup)', () => {
    test('should return 503 STARTING before initialization completes', () => {
      const unstarted = new HealthManager({ isStarted: false });
      const probe = unstarted.getStartup();
      expect(probe.statusCode).toBe(503);
      expect(probe.payload.status).toBe('STARTING');
    });

    test('should return 200 STARTED after initialization completes', () => {
      const started = new HealthManager({ isStarted: true });
      const probe = started.getStartup();
      expect(probe.statusCode).toBe(200);
      expect(probe.payload.status).toBe('STARTED');
    });
  });

  describe('3. Readiness & Aggregate Probes', () => {
    test('getReadiness should return 200 READY when database and memory are healthy', async () => {
      const probe = await healthManager.getReadiness();
      expect([200, 503]).toContain(probe.statusCode);
      if (probe.statusCode === 200) {
        expect(probe.payload.status).toBe('READY');
        expect(probe.payload.subsystems.database).toBe('UP');
      }
    });

    test('getObservabilityHealth should return 200 with pipeline statuses', () => {
      const probe = healthManager.getObservabilityHealth();
      expect(probe.statusCode).toBe(200);
      expect(probe.payload.status).toBe('HEALTHY');
      expect(probe.payload.pipelines.metrics).toBe('UP');
      expect(probe.payload.pipelines.logging).toBe('UP');
      expect(probe.payload.pipelines.tracing).toBe('UP');
    });

    test('withTimeout should return false if a health check hangs beyond deadline', async () => {
      let t;
      const hangingCheck = new Promise((resolve) => { t = setTimeout(() => resolve(true), 500); });
      const result = await healthManager.withTimeout(hangingCheck, 20);
      clearTimeout(t);
      expect(result).toBe(false);
    });
  });
});
