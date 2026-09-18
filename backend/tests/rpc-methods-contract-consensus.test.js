const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { evmRuntime, contractRegistry } = require('../src/evm');
const blockchainService = require('../src/services/blockchainService');

describe('JSON-RPC 2.0 Contract, Consensus, and Node Methods Test Suite (Phase 14)', () => {
  let pdsRegistryAddress;

  beforeAll(async () => {
    await blockchainService.init();
    await evmRuntime.initialize();
    const pdsMeta = contractRegistry.getContract('PDSRegistry');
    pdsRegistryAddress = pdsMeta ? pdsMeta.address : '0x1000000000000000000000000000000000000001';
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('pds_getCode should return bytecode of deployed contract', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({
        jsonrpc: '2.0',
        method: 'pds_getCode',
        params: [pdsRegistryAddress],
        id: 10
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(typeof res.body.result).toBe('string');
    expect(res.body.result.startsWith('0x')).toBe(true);
    expect(res.body.result.length).toBeGreaterThan(10);
  });

  it('pds_call should execute read-only view call on smart contract', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({
        jsonrpc: '2.0',
        method: 'pds_call',
        params: [
          {
            to: pdsRegistryAddress,
            method: 'paused',
            args: []
          }
        ],
        id: 11
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
    expect(res.body.result).toBe(false);
  });

  it('pds_getValidators should return 12 consortium validator nodes', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getValidators', params: [], id: 12 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.result)).toBe(true);
    expect(res.body.result.length).toBe(12);
    expect(res.body.result[0]).toHaveProperty('validatorId');
    expect(res.body.result[0]).toHaveProperty('status');
  });

  it('pds_getConsensusStatus should return FBA consensus status', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getConsensusStatus', params: [], id: 13 });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.model).toContain('Federated Byzantine Agreement');
    expect(res.body.result.validatorsCount).toBe(12);
  });

  it('pds_getNetworkStatus should return P2P transport status', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getNetworkStatus', params: [], id: 14 });

    expect(res.status).toBe(200);
    expect(res.body.result.chainId).toBe(1729);
    expect(res.body.result.protocolVersion).toBe(1);
    expect(res.body.result.status).toBe('HEALTHY');
  });

  it('pds_nodeInfo should return comprehensive node identity and version metadata', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_nodeInfo', params: [], id: 15 });

    expect(res.status).toBe(200);
    expect(res.body.result.clientVersion).toContain('PDSChain');
    expect(res.body.result.protocolVersion).toBe(1);
    expect(res.body.result.chainId).toBe(1729);
    expect(typeof res.body.result.uptime).toBe('number');
  });
});
