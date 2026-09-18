/**
 * Phase 17 Test Suite 3: JSON-RPC 2.0 Method Authorization & Access Control
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const config = require('../src/config/env');
const User = require('../src/models/User');

describe('Phase 17: JSON-RPC 2.0 Method Authorization', () => {
  let citizenToken;
  let adminToken;

  beforeAll(async () => {
    let citizenUser = await User.findOne({ where: { username: 'citizen_rpc' } });
    if (!citizenUser) {
      citizenUser = await User.create({
        username: 'citizen_rpc',
        passwordHash: 'hash',
        role: 'CITIZEN'
      });
    }
    citizenToken = jwt.sign({ id: citizenUser.id, username: citizenUser.username, role: 'CITIZEN' }, config.JWT_SECRET, { expiresIn: '1h' });

    let adminUser = await User.findOne({ where: { username: 'admin_rpc' } });
    if (!adminUser) {
      adminUser = await User.create({
        username: 'admin_rpc',
        passwordHash: 'hash',
        role: 'ADMIN'
      });
    }
    adminToken = jwt.sign({ id: adminUser.id, username: adminUser.username, role: 'ADMIN' }, config.JWT_SECRET, { expiresIn: '1h' });
  });

  describe('1. Public JSON-RPC Methods', () => {
    test('pds_blockNumber should succeed anonymously', async () => {
      const res = await request(app)
        .post('/rpc/v1')
        .send({
          jsonrpc: '2.0',
          method: 'pds_blockNumber',
          params: [],
          id: 1
        });
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.error).toBeUndefined();
    });

    test('pds_validateChain should succeed anonymously', async () => {
      const res = await request(app)
        .post('/rpc/v1')
        .send({
          jsonrpc: '2.0',
          method: 'pds_validateChain',
          params: [],
          id: 2
        });
      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
    });
  });

  describe('2. Protected JSON-RPC Methods - Unauthorized Access Rejection (-32005)', () => {
    test('pds_rebuildProofIndex should reject unauthenticated caller with -32005 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/rpc/v1')
        .send({
          jsonrpc: '2.0',
          method: 'pds_rebuildProofIndex',
          params: [],
          id: 10
        });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32005);
      expect(res.body.error.message).toContain('Unauthorized');
    });

    test('pds_rotateConsensusKey should reject citizen caller with -32005 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/rpc/v1')
        .set('Authorization', `Bearer ${citizenToken}`)
        .send({
          jsonrpc: '2.0',
          method: 'pds_rotateConsensusKey',
          params: [{ targetHeight: 50 }],
          id: 11
        });
      expect(res.status).toBe(200);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe(-32005);
    });
  });

  describe('3. Batch JSON-RPC Authorization', () => {
    test('should process batch with mixed public and unauthorized calls independently', async () => {
      const res = await request(app)
        .post('/rpc/v1')
        .send([
          { jsonrpc: '2.0', method: 'pds_blockNumber', params: [], id: 21 },
          { jsonrpc: '2.0', method: 'pds_rebuildProofIndex', params: [], id: 22 }
        ]);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);

      const successCall = res.body.find(r => r.id === 21);
      expect(successCall.result).toBeDefined();
      expect(successCall.error).toBeUndefined();

      const deniedCall = res.body.find(r => r.id === 22);
      expect(deniedCall.error).toBeDefined();
      expect(deniedCall.error.code).toBe(-32005);
    });
  });
});

