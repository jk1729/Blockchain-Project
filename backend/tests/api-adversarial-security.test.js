const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const blockchainService = require('../src/services/blockchainService');
const { sanitizeSecrets } = require('../src/api/ResponseEnvelope');

describe('API and RPC Adversarial Security and Redaction Test Suite (Phase 14)', () => {
  beforeAll(async () => {
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('sanitizeSecrets should recursively redact private keys, seeds, and passphrases', () => {
    const raw = {
      validatorId: 'VAL-01',
      privateKey: '302e020100300506032b657004220420abcdef1234567890',
      nested: {
        seedPhrase: 'apple banana cherry dog elephant fox grape horse',
        userPassword: 'SuperSecretPassword123!',
        normalData: 'public data'
      },
      array: [
        { secret: 'very-secret', token: 'jwt-token-here' },
        { safe: 'safe-value' }
      ]
    };

    const sanitized = sanitizeSecrets(raw);
    expect(sanitized.validatorId).toBe('VAL-01');
    expect(sanitized.privateKey).toBe('[REDACTED]');
    expect(sanitized.nested.seedPhrase).toBe('[REDACTED]');
    expect(sanitized.nested.userPassword).toBe('[REDACTED]');
    expect(sanitized.nested.normalData).toBe('public data');
    expect(sanitized.array[0].secret).toBe('[REDACTED]');
    expect(sanitized.array[1].safe).toBe('safe-value');
  });

  it('should reject malformed JSON with -32700 Parse Error', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .set('Content-Type', 'application/json')
      .send('{ "jsonrpc": "2.0", "method": "broken');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32700);
  });

  it('should prevent prototype pollution from RPC parameters', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({
        jsonrpc: '2.0',
        method: 'pds_blockNumber',
        params: JSON.parse('{"__proto__": {"polluted": true}}'),
        id: 99
      });

    expect(res.status).toBe(200);
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  it('pds_propose should reject unauthorized calls without appropriate role', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .send({
        jsonrpc: '2.0',
        method: 'pds_propose',
        params: [{ blockNumber: 999 }],
        id: 50
      });

    expect(res.status).toBe(200);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe(-32005);
    expect(res.body.error.message).toContain('Unauthorized');
  });

  it('should reject non-json Content-Type on /rpc with 415', async () => {
    const res = await request(app)
      .post('/rpc/v1')
      .set('Content-Type', 'text/plain')
      .send('plain text request');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe(-32600);
  });
});

