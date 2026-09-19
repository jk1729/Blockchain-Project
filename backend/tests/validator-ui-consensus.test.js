const request = require('supertest');
const app = require('../src/app');
const fbaInstance = require('../src/consensus/FBAConsensus');
const { calculateMerkleRoot } = require('../src/blockchain/merkle');

describe('12-Validator FBA Consensus Telemetry & UI API Test Suite', () => {
  beforeEach(() => {
    fbaInstance.rounds = [];
    fbaInstance.validators.forEach(node => {
      node.status = 'Online';
    });
  });

  describe('1. GET /api/consensus/rounds/latest Endpoint', () => {
    it('should return telemetry for the latest consensus round with all 12 validators', async () => {
      const res = await request(app).get('/api/consensus/rounds/latest');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.round).toBeDefined();

      const round = res.body.round;
      expect(round.totalValidators).toBe(12);
      expect(round.threshold).toBe(9);
      expect(typeof round.verifiedCount).toBe('number');
      expect(typeof round.signedCount).toBe('number');
      expect(typeof round.quorumAchieved).toBe('boolean');
      expect(typeof round.finalized).toBe('boolean');
      expect(Array.isArray(round.validators)).toBe(true);
      expect(round.validators.length).toBe(12);

      // Verify all 12 validator IDs are present
      const expectedIds = [
        'VAL-01', 'VAL-02', 'VAL-03', 'VAL-04',
        'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08',
        'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'
      ];
      const actualIds = round.validators.map(v => v.validatorId);
      expect(actualIds).toEqual(expectedIds);

      // Verify structure of each validator telemetry record
      round.validators.forEach(v => {
        expect(v.validatorId).toBeDefined();
        expect(v.name).toBeDefined();
        expect(v.org).toBeDefined();
        expect(v.address).toBeDefined();
        expect(typeof v.isOnline).toBe('boolean');
        expect(typeof v.verified).toBe('boolean');
        expect(typeof v.signed).toBe('boolean');
        expect(v.vote).toMatch(/^(ACCEPT|REJECT|OFFLINE)$/);
        expect(v.status).toMatch(/^(COMPLETE|REJECTED|OFFLINE)$/);
      });
    });

    it('should strictly redact private keys and cryptographic secrets from validator output', async () => {
      const res = await request(app).get('/api/consensus/rounds/latest');
      const round = res.body.round;

      round.validators.forEach(v => {
        expect(v.privateKey).toBeUndefined();
        expect(v.secret).toBeUndefined();
        expect(v.secretKey).toBeUndefined();
        expect(v.seed).toBeUndefined();
      });

      // Stringify the entire payload and check for leakages
      const rawJson = JSON.stringify(res.body);
      expect(rawJson).not.toContain('privateKey');
      expect(rawJson).not.toContain('secretKey');
    });
  });

  describe('2. GET /api/consensus/rounds/tx/:txId Endpoint', () => {
    it('should return 404 when transaction round does not exist', async () => {
      const res = await request(app).get('/api/consensus/rounds/tx/TXN-NONEXISTENT-9999');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('not found');
    });

    it('should locate and format consensus round when transaction has been processed', async () => {
      // Propose and run a mock block consensus round with valid Merkle root
      const sampleTxId = 'TXN-TEST-' + Date.now();
      const transactions = [{
        transactionId: sampleTxId,
        beneficiaryId: 'BEN-001',
        commodity: 'Rice',
        quantity: 10
      }];
      const validMerkleRoot = calculateMerkleRoot(transactions);

      const mockCandidateBlock = {
        blockNumber: 9999,
        previousHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        merkleRoot: validMerkleRoot,
        transactions: transactions
      };

      const result = await fbaInstance.runBlockConsensus(mockCandidateBlock, {
        stateRoot: '0x9999999999999999999999999999999999999999999999999999999999999999'
      });

      expect(result.status).toBe('ACHIEVED');

      const res = await request(app).get(`/api/consensus/rounds/tx/${sampleTxId}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.round).toBeDefined();
      expect(res.body.round.blockNumber).toBe(9999);
      expect(res.body.round.merkleRoot).toBe(validMerkleRoot);
      expect(res.body.round.validators.length).toBe(12);
      expect(res.body.round.threshold).toBe(9);
    });
  });

  describe('3. Dynamic Quorum Threshold & Node Failure Simulation', () => {
    it('should maintain quorum (11/12 >= 9) when VAL-07 goes offline', () => {
      // Simulate VAL-07 going offline
      const node7 = fbaInstance.validators.get('VAL-07');
      expect(node7).toBeDefined();

      const originalStatus = node7.status;
      try {
        node7.status = 'Offline';

        const round = fbaInstance.getLatestRound();
        const node7Telemetry = round.validators.find(v => v.validatorId === 'VAL-07');

        expect(node7Telemetry.isOnline).toBe(false);
        expect(node7Telemetry.signed).toBe(false);
        expect(node7Telemetry.vote).toBe('OFFLINE');
        expect(node7Telemetry.status).toBe('OFFLINE');

        // Total online signed count should be 11
        expect(round.signedCount).toBe(11);
        expect(round.quorumAchieved).toBe(true);
      } finally {
        node7.status = originalStatus;
      }
    });

    it('should fail quorum (8/12 < 9) when 4 nodes go offline', () => {
      const nodesToFail = ['VAL-07', 'VAL-08', 'VAL-09', 'VAL-10'];
      const originalStatuses = {};

      nodesToFail.forEach(id => {
        const node = fbaInstance.validators.get(id);
        originalStatuses[id] = node.status;
        node.status = 'Offline';
      });

      try {
        const round = fbaInstance.getLatestRound();
        expect(round.signedCount).toBe(8);
        expect(round.threshold).toBe(9);
        expect(round.quorumAchieved).toBe(false);
        expect(round.status).toBe('FAILED');
      } finally {
        nodesToFail.forEach(id => {
          fbaInstance.validators.get(id).status = originalStatuses[id];
        });
      }
    });

    it('should restore quorum (12/12 >= 9) when all nodes are online', () => {
      fbaInstance.validators.forEach(node => {
        node.status = 'Online';
      });

      const round = fbaInstance.getLatestRound();
      expect(round.signedCount).toBe(12);
      expect(round.quorumAchieved).toBe(true);
      expect(round.status).toBe('ACHIEVED');
    });
  });

  describe('4. 4-Stage Consensus Pipeline Stages', () => {
    it('should verify Stage 1 (Verify) and Stage 2 (Sign) execution across online nodes', () => {
      const round = fbaInstance.getLatestRound();
      expect(round.verifiedCount).toBe(12);
      expect(round.signedCount).toBe(12);
      expect(round.quorumAchieved).toBe(true);
      expect(round.finalized).toBe(true);

      round.validators.forEach(v => {
        if (v.isOnline) {
          expect(v.verified).toBe(true);
          expect(v.signed).toBe(true);
          expect(v.signatureDigest).toBeDefined();
        }
      });
    });
  });
});
