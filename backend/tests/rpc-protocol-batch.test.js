const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('JSON-RPC 2.0 Protocol and Batch Processing Test Suite (Phase 14)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should process a valid single JSON-RPC 2.0 request and return result', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({
        jsonrpc: '2.0',
        method: 'pds_blockNumber',
        params: [],
        id: 42
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(42);
    expect(typeof res.body.result).toBe('number');
    expect(res.body.result).toBeGreaterThanOrEqual(1);
  });

  it('should return -32601 Method Not Found for unknown RPC methods', async () => {
    const res = await request(app)
      .post('/rpc')
      .send({
        jsonrpc: '2.0',
        method: 'pds_unknownNonExistentMethod',
        params: [],
        id: 101
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(101);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32601);
    expect(res.body.error.message).toContain('Method');
  });

  it('should return -32600 Invalid Request when jsonrpc != "2.0"', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '1.0',
        method: 'pds_blockNumber',
        params: [],
        id: 1
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
  });

  it('should reject GET /rpc with 405 Method Not Allowed', async () => {
    const res = await request(app).get('/rpc');
    expect(res.status).toBe(405);
    expect(res.headers['allow']).toBe('POST');
  });

  it('should handle batch requests and return matching array of responses', async () => {
    const batch = [
      { jsonrpc: '2.0', method: 'pds_blockNumber', params: [], id: 1 },
      { jsonrpc: '2.0', method: 'pds_validateChain', params: [], id: 2 },
      { jsonrpc: '2.0', method: 'pds_getNetworkStatus', params: [], id: 3 }
    ];

    const res = await request(app)
      .post('/rpc/v1')
      .send(batch);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(3);

    const res1 = res.body.find(r => r.id === 1);
    const res2 = res.body.find(r => r.id === 2);
    const res3 = res.body.find(r => r.id === 3);

    expect(res1.result).toBeDefined();
    expect(res2.result.isValid).toBe(true);
    expect(res3.result.status).toBe('HEALTHY');
  });

  it('should reject batches exceeding maximum allowed batch size of 20', async () => {
    const oversizedBatch = Array.from({ length: 25 }, (_, i) => ({
      jsonrpc: '2.0',
      method: 'pds_blockNumber',
      params: [],
      id: i + 1
    }));

    const res = await request(app)
      .post('/rpc/v1')
      .send(oversizedBatch);

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32600);
    expect(res.body.error.message).toContain('Batch size exceeds maximum limit');
  });
});
