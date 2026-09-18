/**
 * PDSChain Explorer Zero-Secret Leakage Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('Explorer Zero-Secret Leakage Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  const SENSITIVE_PATTERNS = [
    /-----BEGIN (RSA |EC )?PRIVATE KEY-----/i,
    /"privateKey":\s*"[^"]+"/i,
    /"passphrase":\s*"[^"]+"/i,
    /"secret":\s*"[^"]+"/i,
    /"seed":\s*"[^"]+"/i,
    /"password":\s*"[^"]+"/i,
    /"challenge":\s*"[^"]+"/i
  ];

  function assertNoSecrets(responseBody) {
    const rawJson = JSON.stringify(responseBody);
    for (const pattern of SENSITIVE_PATTERNS) {
      expect(rawJson).not.toMatch(pattern);
    }
  }

  it('should not expose secrets in GET /api/v1/explorer/overview', async () => {
    const res = await request(app).get('/api/v1/explorer/overview');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose secrets in GET /api/v1/explorer/search', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=VAL-01');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose secrets in GET /api/v1/explorer/address/VAL-01', async () => {
    const res = await request(app).get('/api/v1/explorer/address/VAL-01');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose secrets in GET /api/v1/explorer/block/0', async () => {
    const res = await request(app).get('/api/v1/explorer/block/0');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose secrets in GET /api/v1/validators', async () => {
    const res = await request(app).get('/api/v1/validators');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose secrets in GET /api/v1/network/peers', async () => {
    const res = await request(app).get('/api/v1/network/peers');
    expect(res.status).toBe(200);
    assertNoSecrets(res.body);
  });

  it('should not expose internal stack traces or secrets in error envelopes', async () => {
    const res = await request(app).get('/api/v1/explorer/block/invalid_block_99999');
    expect(res.status).toBe(404);
    assertNoSecrets(res.body);
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
    expect(JSON.stringify(res.body)).not.toContain('at Function.execute');
  });
});

