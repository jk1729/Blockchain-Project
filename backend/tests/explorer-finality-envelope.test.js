/**
 * PDSChain Explorer Finality and Response Envelope Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('Explorer Finality and Response Envelope Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should include canonical envelope { data, meta, error } on /api/v1/explorer/overview', async () => {
    const res = await request(app).get('/api/v1/explorer/overview');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toBeNull();
    expect(res.body.meta.version).toBe('1.0.0');
    expect(res.body.meta.finality).toBe('FINALIZED');
    expect(res.body.meta.requestId).toMatch(/^req_/);
  });

  it('should include explicit FINALIZED metadata on block details', async () => {
    const res = await request(app).get('/api/v1/explorer/block/0');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('FINALIZED');
    expect(res.body.data.consensusStatus).toBe('FINALIZED');
  });

  it('should include explicit FINALIZED metadata on address details', async () => {
    const res = await request(app).get('/api/v1/explorer/address/BEN-001');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('should return COMMITTED finality on transaction list', async () => {
    const res = await request(app).get('/api/v1/transactions');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('COMMITTED');
  });

  it('should return PENDING finality on mempool inspection', async () => {
    const res = await request(app).get('/api/v1/blockchain/mempool');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('PENDING');
  });

  it('should format explorer 404 errors as standard error envelope', async () => {
    const res = await request(app).get('/api/v1/explorer/block/not-a-block');
    expect(res.status).toBe(404);
    expect(res.body.data).toBeNull();
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BLOCK_NOT_FOUND');
    expect(res.body.meta.requestId).toBeDefined();
  });
});

