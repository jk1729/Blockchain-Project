/**
 * Phase 18: Database Routes, Security & Permission Enforcement Test Suite
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const { defaultDatabaseManager } = require('../src/database');

describe('Phase 18: Database Routes & Security Enforcement', () => {
  let operatorToken;
  let adminToken;
  let citizenToken;

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    const User = require('../src/models/User');

    let opUser = await User.findOne({ where: { username: 'db_operator_test' } });
    if (!opUser) {
      opUser = await User.create({
        username: 'db_operator_test',
        passwordHash: 'hashed_pw',
        role: 'NODE_OPERATOR'
      });
    }
    operatorToken = jwt.sign(
      { id: opUser.id, username: opUser.username, role: 'NODE_OPERATOR' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    let admUser = await User.findOne({ where: { username: 'db_admin_test' } });
    if (!admUser) {
      admUser = await User.create({
        username: 'db_admin_test',
        passwordHash: 'hashed_pw',
        role: 'ADMIN'
      });
    }
    adminToken = jwt.sign(
      { id: admUser.id, username: admUser.username, role: 'ADMIN' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    let citUser = await User.findOne({ where: { username: 'db_citizen_test' } });
    if (!citUser) {
      citUser = await User.create({
        username: 'db_citizen_test',
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
    test('GET /health/database should be publicly accessible and return UP', async () => {
      const res = await request(app).get('/health/database');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('UP');
      expect(res.body.dialect).toBe('sqlite');
    });

    test('GET /api/v1/database/health should return standard API envelope', async () => {
      const res = await request(app).get('/api/v1/database/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('UP');
      expect(res.body.meta.finality).toBe('FINALIZED');
    });

    test('GET /api/v1/database/metrics should export Prometheus metrics format', async () => {
      const res = await request(app).get('/api/v1/database/metrics');
      expect(res.status).toBe(200);
      expect(res.text).toContain('pds_database_commits_total');
      expect(res.text).toContain('pds_database_connections_active');
    });
  });

  describe('2. Protected Status & Schema Endpoints', () => {
    test('GET /api/v1/database/status should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/database/status');
      expect(res.status).toBe(401);
    });

    test('GET /api/v1/database/status should reject citizen token with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/database/status')
        .set('Authorization', `Bearer ${citizenToken}`);
      expect(res.status).toBe(403);
    });

    test('GET /api/v1/database/status should allow operator token with 200 OK', async () => {
      const res = await request(app)
        .get('/api/v1/database/status')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('HEALTHY');
      expect(res.body.data.walMode).toBe(true);
    });

    test('GET /api/v1/database/schema should allow operator to inspect applied migrations', async () => {
      const res = await request(app)
        .get('/api/v1/database/schema')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.appliedCount).toBeDefined();
    });
  });

  describe('3. Protected Administrative Operations (Backup & Integrity)', () => {
    test('POST /api/v1/database/backup should reject citizen with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/database/backup')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({});
      expect(res.status).toBe(403);
    });

    test('POST /api/v1/database/backup should allow operator to trigger verified backup', async () => {
      const res = await request(app)
        .post('/api/v1/database/backup')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({});
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.backupId).toBeDefined();
      expect(res.body.data.manifest).toBeDefined();
    });

    test('POST /api/v1/database/verify-integrity should allow admin to audit ledger integrity', async () => {
      const res = await request(app)
        .post('/api/v1/database/verify-integrity')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.verifiedBlocks).toBeGreaterThanOrEqual(1);
      expect(res.body.data.errors).toBeDefined();
    });
  });
});
