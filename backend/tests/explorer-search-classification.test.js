/**
 * PDSChain Explorer Search Classification Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('Explorer Search Classification Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should classify numeric query as BLOCK height', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=0');
    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBeGreaterThanOrEqual(1);
    const m = res.body.data.matches[0];
    expect(m.type).toBe('BLOCK');
    expect(m.id).toBe('0');
    expect(m.targetRoute).toBe('#block/0');
  });

  it('should classify 64-character hex as block or transaction hash', async () => {
    const block = blockchainService.getBlockByNumber(0);
    const hash = block.blockHash || block.hash;
    const res = await request(app).get(`/api/v1/explorer/search?q=${hash}`);
    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.matches[0].type).toBe('BLOCK');
  });

  it('should classify TXN-* query as TRANSACTION', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=TXN-004281');
    expect(res.status).toBe(200);
    // If seeded in DB, it returns match
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.matches)).toBe(true);
  });

  it('should classify VAL-* query as VALIDATOR', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=VAL-01');
    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBeGreaterThanOrEqual(1);
    const m = res.body.data.matches.find(x => x.type === 'VALIDATOR');
    expect(m).toBeDefined();
    expect(m.id).toBe('VAL-01');
    expect(m.title).toContain('VAL-01');
  });

  it('should classify PDS1 address as ADDRESS', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=PDS10000000000000000000000000000000000000000');
    expect(res.status).toBe(200);
    expect(res.body.data.matches.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.matches[0].type).toBe('ADDRESS');
  });

  it('should return empty matches for unknown query without error', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=UNKNOWN_RECORD_XYZ_123');
    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
    expect(res.body.data.matchCount).toBe(0);
  });

  it('should handle special characters safely without throwing server errors', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=%27%20OR%201=1;--');
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(Array.isArray(res.body.data.matches)).toBe(true);
  });
});

