/**
 * PDSChain Explorer Validator & Consensus Telemetry Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const fbaInstance = require('../src/consensus/FBAConsensus');

describe('Explorer Validator & Consensus Telemetry Test Suite (Phase 15)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('GET /api/v1/validators should return 12 consortium validators', async () => {
    const res = await request(app).get('/api/v1/validators');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(12);
    expect(res.body.meta.finality).toBe('FINALIZED');
  });

  it('GET /api/v1/consensus/quorum should report quorum and slice details', async () => {
    const res = await request(app).get('/api/v1/consensus/quorum');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.networkStatus).toBeDefined();
    expect(res.body.data.networkStatus.totalValidators).toBe(12);
    expect(res.body.data.networkStatus.hasQuorum).toBe(true);
    expect(Array.isArray(res.body.data.slices)).toBe(true);
  });

  it('GET /api/v1/consensus/status should report consensus health and validator counts', async () => {
    const res = await request(app).get('/api/v1/consensus/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.totalValidators).toBe(12);
    expect(res.body.data.onlineCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.hasQuorum).toBe(true);
  });

  it('GET /api/v1/ledger/status should report sync progress and verification state', async () => {
    const res = await request(app).get('/api/v1/ledger/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.state).toBe('CURRENT');
    expect(res.body.data.isConsensusReady).toBe(true);
    expect(res.body.data.verification.stateRoot).toBe('VALID');
    expect(res.body.data.verification.receiptRoot).toBe('VALID');
  });

  it('GET /api/v1/network/topology should provide complete node and edge graph', async () => {
    const res = await request(app).get('/api/v1/network/topology');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data.nodes)).toBe(true);
    expect(res.body.data.nodes.length).toBe(12);
    expect(Array.isArray(res.body.data.edges)).toBe(true);
    expect(res.body.data.edges.length).toBeGreaterThanOrEqual(11);
  });
});
