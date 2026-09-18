const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('JSON-RPC 2.0 Blockchain and Transaction Methods Test Suite (Phase 14)', () => {
  let sampleBlock;
  let sampleTxHash;

  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
    sampleBlock = blockchainService.blockchain.getLatestBlock();
    if (sampleBlock.transactions && sampleBlock.transactions.length > 0) {
      sampleTxHash = sampleBlock.transactions[0].hash || sampleBlock.transactions[0].transactionId;
    }
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('pds_blockNumber should return latest block height', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_blockNumber', params: [], id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeGreaterThanOrEqual(1);
    expect(res.body.result).toBe(sampleBlock.blockNumber);
  });

  it('pds_getBlockByNumber should return block by height or tag "latest"', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getBlockByNumber', params: ['latest', true], id: 2 });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.blockNumber).toBe(sampleBlock.blockNumber);
    expect(res.body.result.blockHash).toBe(sampleBlock.blockHash);
  });

  it('pds_getBlockByHash should return matching block', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getBlockByHash', params: [sampleBlock.blockHash, false], id: 3 });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.blockHash).toBe(sampleBlock.blockHash);
  });

  it('pds_getBlockTransactionCountByNumber should return integer tx count', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_getBlockTransactionCountByNumber', params: [sampleBlock.blockNumber], id: 4 });

    expect(res.status).toBe(200);
    expect(typeof res.body.result).toBe('number');
  });

  it('pds_getTransactionByHash should return transaction details or null', async () => {
    if (sampleTxHash) {
      const res = await request(app)
        .post('/rpc/v1')
        .send({ jsonrpc: '2.0', method: 'pds_getTransactionByHash', params: [sampleTxHash], id: 5 });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.finality).toBe('FINALIZED');
    } else {
      const res = await request(app)
        .post('/rpc/v1')
        .send({ jsonrpc: '2.0', method: 'pds_getTransactionByHash', params: ['0xnonexistenttxhash'], id: 5 });

      expect(res.status).toBe(200);
      expect(res.body.result).toBeNull();
    }
  });

  it('pds_validateChain should report cryptographic validity of ledger', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({ jsonrpc: '2.0', method: 'pds_validateChain', params: [], id: 6 });

    expect(res.status).toBe(200);
    expect(res.body.result.isValid).toBe(true);
    expect(res.body.result.blockCount).toBeGreaterThanOrEqual(1);
  });
});
