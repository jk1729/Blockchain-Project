const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const blockchainService = require('../src/services/blockchainService');

describe('API Contract Envelope and Response Format Test Suite (Phase 14)', () => {
  beforeAll(async () => {
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should return canonical success envelope structure on all /api/v1 endpoints', async () => {
    const res = await request(app).get('/api/v1/blockchain');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toBeNull();
    expect(res.body.meta).toHaveProperty('version', '1.0.0');
    expect(res.body.meta).toHaveProperty('timestamp');
    expect(res.body.meta).toHaveProperty('requestId');
  });

  it('should format error responses as canonical error envelope with standard error codes', async () => {
    const res = await request(app).get('/api/v1/blockchain/blocks/999999');
    expect(res.status).toBe(404);
    expect(res.body.data).toBeNull();
    expect(res.body.meta).toBeDefined();
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BLOCK_NOT_FOUND');
    expect(res.body.error.message).toContain('999999');
  });

  it('should include explicit finality: "FINALIZED" metadata for committed blockchain blocks', async () => {
    const res = await request(app).get('/api/v1/blockchain/blocks/1');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('FINALIZED');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.blockNumber).toBe(1);
  });

  it('should attach cursor pagination pageInfo under meta.pagination for list queries', async () => {
    const res = await request(app).get('/api/v1/blockchain/blocks?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty('pagination');
    const pageInfo = res.body.meta.pagination;
    expect(pageInfo.limit).toBe(2);
    expect(typeof pageInfo.total).toBe('number');
    expect(typeof pageInfo.hasMore).toBe('boolean');
  });

  it('should return 404 with standard error envelope when contract is not found', async () => {
    const res = await request(app).get('/api/v1/contracts/0x000000000000000000000000000000000000dead');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONTRACT_NOT_FOUND');
  });

  it('should return OpenAPI 3.0 document at /api/v1/docs with full schemas', async () => {
    const res = await request(app).get('/api/v1/docs');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.info.title).toContain('PDSChain');
    expect(res.body.paths).toHaveProperty('/health');
    expect(res.body.components.schemas).toHaveProperty('ResponseEnvelope');
  });
});
