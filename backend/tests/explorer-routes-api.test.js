/**
 * PDSChain Explorer Routes API Integration Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');

describe('Explorer Routes API Integration Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('GET /api/v1/explorer/overview should return consolidated chain and consensus metrics', async () => {
    const res = await request(app).get('/api/v1/explorer/overview');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
    expect(res.body.error).toBeNull();

    const data = res.body.data;
    expect(data.chainId).toBe(1729);
    expect(data.networkId).toBeDefined();
    expect(typeof data.finalizedHeight).toBe('number');
    expect(typeof data.totalBlocks).toBe('number');
    expect(data.totalBlocks).toBeGreaterThanOrEqual(1);
    expect(data.validators).toBeDefined();
    expect(data.validators.total).toBe(12);
    expect(data.validators.requiredQuorum).toBe(8);
    expect(data.validators.quorumHealth).toBe('OPERATIONAL');
    expect(Array.isArray(data.recentBlocks)).toBe(true);
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('GET /api/v1/explorer/search should return matches for block height', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=0');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.matches)).toBe(true);
    expect(res.body.data.matches.length).toBeGreaterThanOrEqual(1);
    const blockMatch = res.body.data.matches.find(m => m.type === 'BLOCK');
    expect(blockMatch).toBeDefined();
    expect(blockMatch.id).toBe('0');
    expect(blockMatch.finality).toBe('FINALIZED');
  });

  it('GET /api/v1/explorer/search should return empty matches for empty query', async () => {
    const res = await request(app).get('/api/v1/explorer/search?q=');
    expect(res.status).toBe(200);
    expect(res.body.data.matches).toEqual([]);
  });

  it('GET /api/v1/explorer/address/:address should resolve address details', async () => {
    const res = await request(app).get('/api/v1/explorer/address/BEN-001');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.address).toBe('BEN-001');
    expect(res.body.data.accountType).toBe('BENEFICIARY');
    expect(res.body.data.balance).toBeDefined();
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
  });

  it('GET /api/v1/explorer/block/:identifier should retrieve block by number', async () => {
    const res = await request(app).get('/api/v1/explorer/block/0');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.blockNumber).toBe(0);
    expect(res.body.data.blockHash).toBeDefined();
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('GET /api/v1/explorer/block/:identifier should return 404 for non-existent block', async () => {
    const res = await request(app).get('/api/v1/explorer/block/999999');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BLOCK_NOT_FOUND');
  });

  it('GET /explorer should serve the static HTML explorer', async () => {
    const res = await request(app).get('/explorer');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toContain('PDSChain — Professional Blockchain Explorer');
  });
});

