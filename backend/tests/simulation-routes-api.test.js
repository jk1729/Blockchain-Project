/**
 * PDSChain Simulation REST API Tests (Phase 20 - Stage P)
 * 
 * Verifies endpoints under /api/v1/simulations:
 * - GET /scenarios
 * - POST /run
 * - GET /:simulationId
 * - POST /:simulationId/stop
 * - GET /:simulationId/evidence
 * - GET /history
 * - Enforces SIMULATION_MODE gate, authentication, and RBAC permissions.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { defaultDatabaseManager } = require('../src/database');
const { SafetyGuard } = require('../src/simulation');

describe('Simulation REST APIs (/api/v1/simulations)', () => {
  let operatorToken;
  let citizenToken;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    const User = require('../src/models/User');

    let opUser = await User.findOne({ where: { username: 'sim_operator_test' } });
    if (!opUser) {
      opUser = await User.create({
        username: 'sim_operator_test',
        passwordHash: 'hashed_pw',
        role: 'NODE_OPERATOR'
      });
    }
    operatorToken = jwt.sign(
      { id: opUser.id, username: opUser.username, role: 'NODE_OPERATOR' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    let citUser = await User.findOne({ where: { username: 'sim_citizen_test' } });
    if (!citUser) {
      citUser = await User.create({
        username: 'sim_citizen_test',
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

  describe('1. Mode Gating & Auth Guard', () => {
    test('Refuses access when SIMULATION_MODE is not set', async () => {
      delete process.env.SIMULATION_MODE;

      const res = await request(app)
        .get('/api/v1/simulations/scenarios')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('E_SIMULATION_MODE_DISABLED');
    });

    test('Requires authentication token when SIMULATION_MODE is true', async () => {
      process.env.SIMULATION_MODE = 'true';

      const res = await request(app).get('/api/v1/simulations/scenarios');
      expect(res.status).toBe(401);
    });

    test('Rejects unauthorized role (CITIZEN) with 403 Forbidden', async () => {
      process.env.SIMULATION_MODE = 'true';

      const res = await request(app)
        .get('/api/v1/simulations/scenarios')
        .set('Authorization', `Bearer ${citizenToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('2. Authorized Simulation Workflows', () => {
    let executedSimId = null;

    beforeEach(() => {
      process.env.SIMULATION_MODE = 'true';
      process.env.NODE_ENV = 'test';
    });

    test('GET /api/v1/simulations/scenarios lists all registered scenarios', async () => {
      const res = await request(app)
        .get('/api/v1/simulations/scenarios')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(29);
      expect(Array.isArray(res.body.data.scenarios)).toBe(true);
    });

    test('GET /api/v1/simulations/scenarios?category=CONSENSUS filters by category', async () => {
      const res = await request(app)
        .get('/api/v1/simulations/scenarios?category=CONSENSUS')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.scenarios.length).toBe(4);
      expect(res.body.data.scenarios.every(s => s.category === 'CONSENSUS')).toBe(true);
    });

    test('POST /api/v1/simulations/run executes a scenario and returns evidence', async () => {
      const res = await request(app)
        .post('/api/v1/simulations/run')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          scenarioId: 'AUTH-001',
          seed: 9999
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.simulationId).toBeDefined();
      expect(res.body.data.result).toBe('PASSED');

      executedSimId = res.body.data.simulationId;
    });

    test('POST /api/v1/simulations/run returns 404 for unknown scenario', async () => {
      const res = await request(app)
        .post('/api/v1/simulations/run')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ scenarioId: 'UNKNOWN-999' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('E_SCENARIO_NOT_FOUND');
    });

    test('GET /api/v1/simulations/history returns execution history', async () => {
      const res = await request(app)
        .get('/api/v1/simulations/history?limit=10')
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.history)).toBe(true);
      expect(res.body.data.history.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /api/v1/simulations/:simulationId retrieves status', async () => {
      const res = await request(app)
        .get(`/api/v1/simulations/${executedSimId}`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.simulationId).toBe(executedSimId);
      expect(res.body.data.result).toBe('PASSED');
    });

    test('GET /api/v1/simulations/:simulationId/evidence retrieves evidence report', async () => {
      const res = await request(app)
        .get(`/api/v1/simulations/${executedSimId}/evidence`)
        .set('Authorization', `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.invariants).toBeDefined();
      expect(res.body.data.events).toBeDefined();
    });

    test('POST /api/v1/simulations/:simulationId/stop handles stop request safely', async () => {
      const res = await request(app)
        .post(`/api/v1/simulations/${executedSimId}/stop`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'Test stop request' });

      expect(res.status).toBe(200);
      // Already finished simulation
      expect(res.body.success).toBe(false);
      expect(res.body.data.reason).toContain('already finished');
    });
  });
});

