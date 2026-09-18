const request = require('supertest');
const app = require('../src/app');

describe('PHASE 9: Network Observability & REST API Test Suite', () => {
  describe('1. GET /api/network/status', () => {
    test('1. should return network status and federation overview', async () => {
      const res = await request(app)
        .get('/api/network/status')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.chainId).toBe(1729);
      expect(res.body.protocolVersion).toBe(1);
      expect(res.body.federationSize).toBe(12);
      expect(res.body.status).toBeDefined();
    });
  });

  describe('2. GET /api/network/peers', () => {
    test('2. should return list of active peers with connection details', async () => {
      const res = await request(app)
        .get('/api/network/peers')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.peers)).toBe(true);
      expect(res.body.count).toBeGreaterThanOrEqual(1);

      const peer = res.body.peers[0];
      expect(peer.validatorId).toBeDefined();
      expect(peer.state).toBeDefined();
    });
  });

  describe('3. GET /api/network/topology', () => {
    test('3. should return complete 12-validator network topology with trust configs', async () => {
      const res = await request(app)
        .get('/api/network/topology')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.totalValidators).toBe(12);
      expect(res.body.globalAgreementThreshold).toBe(9);
      expect(res.body.quorumSliceThreshold).toBe(3);
      expect(res.body.validators.length).toBe(12);

      const val1 = res.body.validators[0];
      expect(val1.validatorId).toBe('VAL-01');
      expect(val1.p2pPort).toBe(5001);
      expect(val1.trustConfiguration).toBeDefined();
      expect(val1.trustConfiguration.quorumSlice.length).toBe(4);
    });
  });

  describe('4. GET /api/network/metrics', () => {
    test('4. should return JSON metrics snapshot by default', async () => {
      const res = await request(app)
        .get('/api/network/metrics')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.metrics).toBeDefined();
      expect(res.body.metrics.messagesSentTotal).toBeDefined();
      expect(res.body.metrics.messagesReceivedTotal).toBeDefined();
    });

    test('5. should return Prometheus text format when requested', async () => {
      const res = await request(app)
        .get('/api/network/metrics')
        .set('Accept', 'text/plain')
        .expect(200);

      expect(typeof res.text).toBe('string');
      expect(res.text).toContain('pdschain_network_active_connections');
      expect(res.text).toContain('pdschain_network_messages_sent_total');
      expect(res.text).toContain('pdschain_network_duplicates_total');
    });
  });
});

