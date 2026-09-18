/**
 * PDSChain Explorer Contract View-Call Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { evmRuntime, contractRegistry } = require('../src/evm');
const blockchainService = require('../src/services/blockchainService');

describe('Explorer Contract View-Call Test Suite (Phase 15)', () => {
  let registryAddress;

  beforeAll(async () => {
    await blockchainService.init();
    await evmRuntime.initialize();
    const pdsMeta = contractRegistry.getContract('PDSRegistry');
    registryAddress = pdsMeta ? pdsMeta.address : '0x1000000000000000000000000000000000000001';
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('GET /api/v1/contracts should return deployed smart contracts directory', async () => {
    const res = await request(app).get('/api/v1/contracts');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.contracts)).toBe(true);
    expect(res.body.data.contracts.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('GET /api/v1/contracts/:address should return contract details with ABI', async () => {
    const res = await request(app).get(`/api/v1/contracts/${registryAddress}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.address).toBe(registryAddress);
    expect(res.body.data.codeHash).toBeDefined();
    expect(Array.isArray(res.body.data.abi)).toBe(true);
  });

  it('POST /api/v1/contracts/call should execute read-only view call safely', async () => {
    const res = await request(app)
      .post('/api/v1/contracts/call')
      .send({
        contractAddress: registryAddress,
        method: 'paused',
        args: [],
        isView: true
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toBe(false); // contract is not paused
    expect(res.body.meta.isView).toBe(true);
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('POST /api/v1/contracts/call should validate required contractAddress parameter', async () => {
    const res = await request(app)
      .post('/api/v1/contracts/call')
      .send({
        method: 'paused',
        args: [],
        isView: true
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/v1/contracts/call should safely handle call to unknown method', async () => {
    const res = await request(app)
      .post('/api/v1/contracts/call')
      .send({
        contractAddress: registryAddress,
        method: 'nonExistentMethod',
        args: [],
        isView: true
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
