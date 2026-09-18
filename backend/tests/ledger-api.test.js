/**
 * PDSChain Phase 10: Ledger Observability API Test Suite
 */

const request = require('supertest');
const app = require('../src/app');

describe('PHASE 10: Ledger Observability & REST API Suite', () => {
  describe('1. GET /api/ledger/status', () => {
    test('1.1 should return comprehensive ledger status, verification status and heights', async () => {
      const res = await request(app).get('/api/ledger/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.state).toBeDefined();
      expect(res.body.isConsensusReady).toBeDefined();
      expect(res.body.heights).toBeDefined();
      expect(res.body.heights.finalized).toBeGreaterThanOrEqual(0);
      expect(res.body.latestBlock).toBeDefined();
      expect(res.body.verification).toBeDefined();
      expect(res.body.verification.status).toBeDefined();
      expect(res.body.syncProgress).toBeDefined();
    });
  });

  describe('2. GET /api/ledger/checkpoint', () => {
    test('2.1 should return checkpoint information', async () => {
      const res = await request(app).get('/api/ledger/checkpoint');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('3. GET /api/network/sync/status', () => {
    test('3.1 should return network sync status snapshot', async () => {
      const res = await request(app).get('/api/network/sync/status');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sync).toBeDefined();
      expect(res.body.sync.state).toBeDefined();
    });
  });
});

