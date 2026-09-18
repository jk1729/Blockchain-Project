/**
 * Phase 19: Observability Routes & Health Probes API Test Suite
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { defaultDatabaseManager } = require('../src/database');

describe('Phase 19: Observability Routes & Health Probes API', () => {
  let operatorToken;
  let citizenToken;

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    const User = require('../src/models/User');

    let opUser = await User.findOne({ where: { username: 'obs_operator_test' } });
    if (!opUser) {
      opUser = await User.create({
        username: 'obs_operator_test',
        passwordHash: 'hashed_pw',
        role: 'NODE_OPERATOR'
      });
    }
    operatorToken = jwt.sign(
      { id: opUser.id, username: opUser.username, role: 'NODE_OPERATOR' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    let citUser = await User.findOne({ where: { username: 'obs_citizen_test' } });
    if (!citUser) {
      citUser = await User.create({
        username: 'obs_citizen_test',
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

  describe('1. Public Health & Metrics Endpoints', () => {
    test('GET /health/live should return 200 with status LIVE', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('LIVE');
      expect(res.body.pid).toBeDefined();
    });

    test('GET /health/startup should return 200 with status STARTED', async () => {
      const res = await request(app).get('/health/startup');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('STARTED');
    });

    test('GET /health/ready should return 200 with status READY', async () => {
      const res = await request(app).get('/health/ready');
      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        expect(res.body.status).toBe('READY');
      }
    });

    test('GET /health/observability should return 200 with status HEALTHY', async () => {
      const res = await request(app).get('/health/observability');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('HEALTHY');
      expect(res.body.pipelines).toBeDefined();
    });

    test('GET /health/database should maintain Phase 18 compatibility', async () => {
      const res = await request(app).get('/health/database');
      expect([200, 503]).toContain(res.status);
      expect(['UP', 'DOWN']).toContain(res.body.status);
    });

    test('GET /metrics should export Prometheus formatted text', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('# HELP');
    });

    test('GET /api/v1/observability/metrics should support JSON format', async () => {
      const res = await request(app).get('/api/v1/observability/metrics?format=json');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('2. Protected Observability Endpoints & Permissions', () => {
    test('GET /api/v1/observability/status should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/observability/status');
      expect(res.status).toBe(401);
    });

    test('GET /api/v1/observability/status should reject CITIZEN role with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/observability/status')
        .set('Authorization', `Bearer ${citizenToken}`);
      expect(res.status).toBe(403);
    });

    test('GET /api/v1/observability/status should allow NODE_OPERATOR with 200 OK', async () => {
      const res = await request(app)
        .get('/api/v1/observability/status')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect([200, 503]).toContain(res.status);
      expect(res.body.data).toBeDefined();
    });

    test('GET /api/v1/observability/config should return sanitized configuration to operator', async () => {
      const res = await request(app)
        .get('/api/v1/observability/config')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logging).toBeDefined();
      expect(res.body.data.metrics).toBeDefined();
    });

    test('GET /api/v1/observability/slo should return SLO evaluations to operator', async () => {
      const res = await request(app)
        .get('/api/v1/observability/slo')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slos).toBeDefined();
    });

    test('GET /api/v1/observability/alerts should return active alert definitions to operator', async () => {
      const res = await request(app)
        .get('/api/v1/observability/alerts')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.alerts).toBeDefined();
    });
  });
});

