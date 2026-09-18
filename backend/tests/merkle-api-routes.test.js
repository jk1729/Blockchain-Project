/**
 * Merkle Proof REST API Routes Test Suite (Phase 16 - Stage I & Q)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');
const Transaction = require('../src/blockchain/Transaction');
const EVMReceipt = require('../src/evm/EVMReceipt');
const { MerkleTree } = require('../src/blockchain/merkle');

describe('Merkle Proof REST API Routes Test Suite', () => {
  let testTxId = 'TXN-ROUTE-PROOF-01';
  let testBlockNumber;
  let testReceiptHash;

  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();

    const tx = new Transaction({
      transactionId: testTxId,
      sender: 'BEN-001',
      receiver: 'FPS-001',
      payload: { commodity: 'Rice', quantity: 10 }
    });

    const receipt = new EVMReceipt({
      transactionId: testTxId,
      contractAddress: '0x2222222222222222222222222222222222222222',
      status: 'SUCCESS',
      gasUsed: 21000,
      logs: [{
        eventId: 'EVT-ROUTE-01',
        topics: ['0xtopic'],
        data: '0xdata'
      }]
    });
    testReceiptHash = receipt.receiptHash;

    const receiptsRoot = new MerkleTree([receipt], { commitmentType: 'RECEIPT' }).getRoot();

    const newBlock = await blockchainService.addBlock(
      [tx.toBlockPayload()],
      [],
      null,
      '0x' + '2'.repeat(64),
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

  describe('GET /api/v1/proofs/status', () => {
    it('should return proof indexer status and telemetry snapshot', async () => {
      const res = await request(app).get('/api/v1/proofs/status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body.error).toBeNull();
      expect(res.body.data.indexer.status).toBe('READY');
      expect(res.body.data.indexer.indexedBlocks).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/proofs/transactions/:txHash', () => {
    it('should return valid inclusion proof for existing transaction', async () => {
      const res = await request(app).get(`/api/v1/proofs/transactions/${testTxId}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.meta.finality).toBe('FINALIZED');
      expect(res.body.error).toBeNull();

      const proof = res.body.data;
      expect(proof.commitmentType).toBe('TRANSACTION');
      expect(proof.leafIndex).toBe(0);
      expect(proof.expectedRoot).toBeDefined();
      expect(Array.isArray(proof.siblings)).toBe(true);
    });

    it('should return 404 for unknown transaction', async () => {
      const res = await request(app).get('/api/v1/proofs/transactions/TXN-NON-EXISTENT');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('PROOF_NOT_FOUND');
    });
  });

  describe('GET /api/v1/proofs/blocks/:height/transactions/:index', () => {
    it('should return proof for transaction at block height and index', async () => {
      const res = await request(app).get(`/api/v1/proofs/blocks/${testBlockNumber}/transactions/0`);
      expect(res.status).toBe(200);
      expect(res.body.data.leafIndex).toBe(0);
      expect(res.body.data.blockHeight).toBe(testBlockNumber);
    });

    it('should return 400 for out-of-bounds index', async () => {
      const res = await request(app).get(`/api/v1/proofs/blocks/${testBlockNumber}/transactions/999`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INDEX_OUT_OF_BOUNDS');
    });
  });

  describe('GET /api/v1/proofs/receipts/:txHash', () => {
    it('should return receipt proof for transaction execution', async () => {
      const res = await request(app).get(`/api/v1/proofs/receipts/${testTxId}`);
      expect(res.status).toBe(200);
      expect(res.body.data.commitmentType).toBe('RECEIPT');
      expect(res.body.data.expectedRoot).toBeDefined();
    });
  });

  describe('GET /api/v1/proofs/events/:eventId', () => {
    it('should return event proof linked to parent receipt', async () => {
      const res = await request(app).get('/api/v1/proofs/events/EVT-ROUTE-01');
      expect(res.status).toBe(200);
      expect(res.body.data.eventId).toBe('EVT-ROUTE-01');
      expect(res.body.data.receiptProof).toBeDefined();
    });
  });

  describe('POST /api/v1/proofs/verify', () => {
    it('should verify a valid proof independently', async () => {
      const proofRes = await request(app).get(`/api/v1/proofs/transactions/${testTxId}`);
      const proof = proofRes.body.data;

      const verifyRes = await request(app)
        .post('/api/v1/proofs/verify')
        .send({ proof });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(true);
      expect(verifyRes.body.data.computedRoot).toBe(proof.expectedRoot);
    });

    it('should fail verification when expectedRoot is tampered', async () => {
      const proofRes = await request(app).get(`/api/v1/proofs/transactions/${testTxId}`);
      const proof = { ...proofRes.body.data, expectedRoot: '0'.repeat(64) };

      const verifyRes = await request(app)
        .post('/api/v1/proofs/verify')
        .send({ proof });

      expect(verifyRes.status).toBe(200);
      expect(verifyRes.body.data.valid).toBe(false);
      expect(verifyRes.body.data.reason).toBe('ROOT_MISMATCH');
    });

    it('should return 400 when proof payload is missing or invalid', async () => {
      const res = await request(app)
        .post('/api/v1/proofs/verify')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MALFORMED_PROOF');
    });
  });

  describe('GET /api/v1/proofs/blocks/:identifier/tree', () => {
    it('should return Merkle tree structure for block', async () => {
      const res = await request(app).get(`/api/v1/proofs/blocks/${testBlockNumber}/tree`);
      expect(res.status).toBe(200);
      expect(res.body.data.blockNumber).toBe(testBlockNumber);
      expect(Array.isArray(res.body.data.layers)).toBe(true);
    });
  });
});

