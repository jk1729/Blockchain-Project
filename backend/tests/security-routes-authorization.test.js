/**
 * Phase 17 Test Suite 2: REST Routes Authorization & RBAC
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const User = require('../src/models/User');

describe('Phase 17: REST Routes Authorization & Role Protection', () => {
  let citizenToken;
  let adminToken;
  let shopToken;

  beforeAll(async () => {
    // Generate valid tokens
    let citizenUser = await User.findOne({ where: { username: 'citizen_test' } });
    if (!citizenUser) {
      citizenUser = await User.create({
        username: 'citizen_test',
        passwordHash: 'hashed_pw',
        role: 'CITIZEN',
        entityId: 'BEN-999'
      });
    }
    citizenToken = jwt.sign({ id: citizenUser.id, username: citizenUser.username, role: 'CITIZEN' }, config.JWT_SECRET, { expiresIn: '1h' });

    let adminUser = await User.findOne({ where: { username: 'admin_test' } });
    if (!adminUser) {
      adminUser = await User.create({
        username: 'admin_test',
        passwordHash: 'hashed_pw',
        role: 'ADMIN'
      });
    }
    adminToken = jwt.sign({ id: adminUser.id, username: adminUser.username, role: 'ADMIN' }, config.JWT_SECRET, { expiresIn: '1h' });

    let shopUser = await User.findOne({ where: { username: 'shop_test' } });
    if (!shopUser) {
      shopUser = await User.create({
        username: 'shop_test',
        passwordHash: 'hashed_pw',
        role: 'SHOP',
        entityId: 'FPS-777'
      });
    }
    shopToken = jwt.sign({ id: shopUser.id, username: shopUser.username, role: 'SHOP' }, config.JWT_SECRET, { expiresIn: '1h' });
  });

  describe('1. Public Routes Access', () => {
    test('GET /api/v1/health should be publicly accessible without authentication', async () => {
      const res = await request(app).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(['HEALTHY', 'UP']).toContain(res.body.data.status);
    });

    test('GET /api/v1/blockchain/blocks should be publicly accessible without authentication', async () => {
      const res = await request(app).get('/api/v1/blockchain/blocks');
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    test('GET /api/v1/security/metrics should export Prometheus metrics publicly', async () => {
      const res = await request(app)
        .get('/api/v1/security/metrics')
        .set('Accept', 'text/plain');
      expect(res.status).toBe(200);
      expect(res.text).toContain('pds_security_authz_denials_total');
    });
  });

  describe('2. Protected Routes - Authentication Enforced (401)', () => {
    test('GET /api/v1/security/audit should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/v1/security/audit');
      expect(res.status).toBe(401);
    });

    test('POST /api/v1/security/api-keys should reject unauthenticated request with 401', async () => {
      const res = await request(app)
        .post('/api/v1/security/api-keys')
        .send({ name: 'Hacked Key' });
      expect(res.status).toBe(401);
    });

    test('POST /api/v1/security/break-glass/activate should reject unauthenticated with 401', async () => {
      const res = await request(app)
        .post('/api/v1/security/break-glass/activate')
        .send({ operatorId: 'malicious' });
      expect(res.status).toBe(401);
    });
  });

  describe('3. Protected Routes - Role Authorization Enforced (403)', () => {
    test('GET /api/v1/security/audit should reject citizen token with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/v1/security/audit')
        .set('Authorization', `Bearer ${citizenToken}`);
      expect(res.status).toBe(403);
    });

    test('POST /api/v1/security/api-keys should reject shop token with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/v1/security/api-keys')
        .set('Authorization', `Bearer ${shopToken}`)
        .send({ name: 'Unauthorized Key' });
      expect(res.status).toBe(403);
    });

    test('POST /api/beneficiaries should reject citizen token with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/beneficiaries')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({ name: 'Unauthorized Beneficiary' });
      expect(res.status).toBe(403);
    });
  });

  describe('4. Authorized Admin Access (200 / 201)', () => {
    test('GET /api/v1/security/audit should allow admin token with 200 OK', async () => {
      const res = await request(app)
        .get('/api/v1/security/audit')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    test('POST /api/v1/security/api-keys should allow admin to issue API keys', async () => {
      const res = await request(app)
        .post('/api/v1/security/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Integration Test Key', role: 'CLIENT' });
      expect(res.status).toBe(201);
      expect(res.body.data.apiKey).toBeDefined();
      expect(res.body.data.keyId).toBeDefined();
    });
  });
});
