/**
 * JSON-RPC 2.0 Merkle Proof Methods Test Suite (Phase 16 - Stage J & Q)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');
const Transaction = require('../src/blockchain/Transaction');
const EVMReceipt = require('../src/evm/EVMReceipt');
const { MerkleTree } = require('../src/blockchain/merkle');

describe('JSON-RPC 2.0 Proof Methods Test Suite', () => {
  let testTxId = 'TXN-RPC-PROOF-01';
  let testBlockNumber;

  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();

    const tx = new Transaction({
      transactionId: testTxId,
      sender: 'BEN-001',
      receiver: 'FPS-001',
      payload: { commodity: 'Rice', quantity: 15 }
    });

    const receipt = new EVMReceipt({
      transactionId: testTxId,
      contractAddress: '0x3333333333333333333333333333333333333333',
      status: 'SUCCESS',
      gasUsed: 21000,
      logs: [{
        eventId: 'EVT-RPC-01',
        topics: ['0xrpc'],
        data: '0x1234'
      }]
    });

    const receiptsRoot = new MerkleTree([receipt], { commitmentType: 'RECEIPT' }).getRoot();

    const newBlock = await blockchainService.addBlock(
      [tx.toBlockPayload()],
      [],
      null,
      '0x' + '3'.repeat(64),
      {
        version: 1,
        receiptsRoot,
        executionReceipts: [receipt.toJSON()],
        consensusStatus: 'FINALIZED'
      }
    );

    testBlockNumber = newBlock.blockNumber;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('pds_getTransactionProof should return valid proof via JSON-RPC', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'pds_getTransactionProof',
        params: [testTxId]
      });

    expect(res.status).toBe(200);
    expect(res.body.jsonrpc).toBe('2.0');
    expect(res.body.id).toBe(1);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.leafIndex).toBe(0);
    expect(res.body.result.expectedRoot).toBeDefined();
    expect(res.body.error).toBeUndefined();
  });

  it('pds_getReceiptProof should return receipt inclusion proof', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 2,
        method: 'pds_getReceiptProof',
        params: [testTxId]
      });

    expect(res.status).toBe(200);
    expect(res.body.result).toBeDefined();
    expect(res.body.result.commitmentType).toBe('RECEIPT');
  });

  it('pds_getEventProof should return event log proof linked to receipt', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 3,
        method: 'pds_getEventProof',
        params: ['EVT-RPC-01']
      });

    expect(res.status).toBe(200);
    expect(res.body.result.eventId).toBe('EVT-RPC-01');
    expect(res.body.result.receiptProof).toBeDefined();
  });

  it('pds_verifyMerkleProof should verify proof object via JSON-RPC', async () => {
    // First fetch proof
    const pRes = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 4,
        method: 'pds_getTransactionProof',
        params: [testTxId]
      });

    const proof = pRes.body.result;

    const vRes = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 5,
        method: 'pds_verifyMerkleProof',
        params: [proof]
      });

    expect(vRes.status).toBe(200);
    expect(vRes.body.result.valid).toBe(true);
    expect(vRes.body.result.computedRoot).toBe(proof.expectedRoot);
  });

  it('pds_getMerkleRoot should return committed root for block', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 6,
        method: 'pds_getMerkleRoot',
        params: [testBlockNumber, 'TRANSACTION']
      });

    expect(res.status).toBe(200);
    expect(res.body.result.root).toBeDefined();
    expect(res.body.result.commitmentType).toBe('TRANSACTION');
  });

  it('pds_getProofStatus should return indexer status', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 7,
        method: 'pds_getProofStatus',
        params: []
      });

    expect(res.status).toBe(200);
    expect(res.body.result.indexer.status).toBe('READY');
  });

  it('should support batch JSON-RPC proof verification', async () => {
    const pRes = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 10,
        method: 'pds_getTransactionProof',
        params: [testTxId]
      });

    const proof = pRes.body.result;

    const batchRes = await request(app)
      .post('/api/v1/rpc')
      .send([
        { jsonrpc: '2.0', id: 11, method: 'pds_verifyMerkleProof', params: [proof] },
        { jsonrpc: '2.0', id: 12, method: 'pds_getMerkleRoot', params: [testBlockNumber] }
      ]);

    expect(batchRes.status).toBe(200);
    expect(Array.isArray(batchRes.body)).toBe(true);
    expect(batchRes.body.length).toBe(2);
    expect(batchRes.body[0].result.valid).toBe(true);
    expect(batchRes.body[1].result.root).toBeDefined();
  });

  it('should return JSON-RPC error for invalid parameters', async () => {
    const res = await request(app)
      .post('/api/v1/rpc')
      .send({
        jsonrpc: '2.0',
        id: 99,
        method: 'pds_getTransactionProof',
        params: []
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32602); // INVALID_PARAMS
  });
});

