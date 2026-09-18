/**
 * PDSChain Performance REST API Tests (Phase 21 - Stage O)
 * 
 * Verifies endpoints under /api/v1/performance:
 * - GET /workloads
 * - POST /runs
 * - GET /runs/:performanceRunId
 * - POST /runs/:performanceRunId/stop
 * - GET /runs/:performanceRunId/evidence
 * - GET /history
 * Enforces PERFORMANCE_TEST_MODE gating, authentication, and RBAC permissions.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { defaultDatabaseManager } = require('../src/database');

describe('Performance REST APIs (/api/v1/performance)', () => {
  let operatorToken;
  let citizenToken;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    const User = require('../src/models/User');

    let opUser = await User.findOne({ where: { username: 'perf_operator_test' } });
    if (!opUser) {
      opUser = await User.create({
        username: 'perf_operator_test',
        passwordHash: 'hashed_pw',
        role: 'NODE_OPERATOR'
      });
    }
    operatorToken = jwt.sign(
      { id: opUser.id, username: opUser.username, role: 'NODE_OPERATOR' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    let citUser = await User.findOne({ where: { username: 'perf_citizen_test' } });
    if (!citUser) {
      citUser = await User.create({
        username: 'perf_citizen_test',
        passwordHash: 'hashed_pw',
        role: 'CITIZEN'
      });
    }
    citizenToken = jwt.sign(
      { id: citUser.id, username: citUser.username, role: 'CITIZEN' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('Environment Gating & Authentication', () => {
    test('Refuses all performance API access when PERFORMANCE_TEST_MODE is not active', async () => {
      delete process.env.PERFORMANCE_TEST_MODE;
      delete process.env.SIMULATION_MODE;

      const res = await request(app)
        .get('/api/v1/performance/workloads')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('E_PERFORMANCE_MODE_DISABLED');
    });

    test('Requires authentication token when PERFORMANCE_TEST_MODE is enabled', async () => {
      process.env.PERFORMANCE_TEST_MODE = 'true';
      process.env.NODE_ENV = 'test';

      const res = await request(app)
        .get('/api/v1/performance/workloads');

      expect(res.status).toBe(401);
    });

    test('Rejects access from roles lacking performance permissions (e.g. CITIZEN)', async () => {
      process.env.PERFORMANCE_TEST_MODE = 'true';
      process.env.NODE_ENV = 'test';

      const res = await request(app)
        .get('/api/v1/performance/workloads')
        .set('Authorization', `Bearer ${citizenToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Performance Workload Endpoints', () => {
    beforeEach(() => {
      process.env.PERFORMANCE_TEST_MODE = 'true';
      process.env.NODE_ENV = 'test';
    });

    test('GET /workloads returns all registered workloads for authorized operator', async () => {
      const res = await request(app)
        .get('/api/v1/performance/workloads')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBeGreaterThanOrEqual(9);
      expect(Array.isArray(res.body.data.workloads)).toBe(true);
    });

    test('GET /workloads?category= filters workloads by category', async () => {
      const res = await request(app)
        .get('/api/v1/performance/workloads?category=API_PUBLIC_DISTRIBUTION')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.workloads.every(w => w.category === 'API_PUBLIC_DISTRIBUTION')).toBe(true);
    });

    test('POST /runs validates required workloadId', async () => {
      const res = await request(app)
        .post('/api/v1/performance/runs')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('E_INVALID_PARAMETER');
    });

    test('POST /runs returns 404 for unknown workload', async () => {
      const res = await request(app)
        .post('/api/v1/performance/runs')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ workloadId: 'UNKNOWN-999' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('E_WORKLOAD_NOT_FOUND');
    });

    test('POST /runs executes workload and records in history and evidence', async () => {
      const res = await request(app)
        .post('/api/v1/performance/runs')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          workloadId: 'API-001',
          durationMs: 300,
          concurrency: 4,
          targetRps: 40
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.workloadId).toBe('API-001');
      expect(res.body.data.result).toBe('PASSED');

      const runId = res.body.data.performanceRunId;
      expect(runId).toBeDefined();

      // Query history
      const historyRes = await request(app)
        .get('/api/v1/performance/history')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(historyRes.status).toBe(200);
      expect(historyRes.body.data.history.some(r => r.performanceRunId === runId)).toBe(true);

      // Query specific run
      const runRes = await request(app)
        .get(`/api/v1/performance/runs/${runId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(runRes.status).toBe(200);
      expect(runRes.body.data.performanceRunId).toBe(runId);

      // Query evidence
      const evidenceRes = await request(app)
        .get(`/api/v1/performance/runs/${runId}/evidence`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(evidenceRes.status).toBe(200);
      expect(evidenceRes.body.data.performanceRunId).toBe(runId);
      expect(evidenceRes.body.data.latency).toBeDefined();
    });

    test('GET /runs/:performanceRunId returns 404 for nonexistent run', async () => {
      const res = await request(app)
        .get('/api/v1/performance/runs/nonexistent-run-id')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('E_RUN_NOT_FOUND');
    });

    test('POST /runs/:performanceRunId/stop handles nonexistent or already finished run', async () => {
      const res = await request(app)
        .post('/api/v1/performance/runs/nonexistent-run-id/stop')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'Operator requested abort' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(false);
      expect(res.body.data.stopped).toBe(false);
    });
  });
});
