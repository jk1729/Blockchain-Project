const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const blockchainService = require('../src/services/blockchainService');
const { encodeCursor, decodeCursor, paginateArray } = require('../src/api/CursorPagination');

describe('API Cursor Pagination and Finality Semantics Test Suite (Phase 14)', () => {
  beforeAll(async () => {
    await seedDatabase(true);
    await blockchainService.init();
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('encodeCursor and decodeCursor should handle bidirectional base64 conversion', () => {
    const original = { offset: 40, height: 100 };
    const cursor = encodeCursor(original);
    expect(typeof cursor).toBe('string');

    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual(original);
  });

  it('decodeCursor should return null on invalid or malformed cursor string', () => {
    expect(decodeCursor('not-valid-base64-json!')).toBeNull();
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('paginateArray should slice correctly and provide forward and backward cursor tokens', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const page1 = paginateArray(items, { limit: 3 });

    expect(page1.items).toEqual([1, 2, 3]);
    expect(page1.pageInfo.limit).toBe(3);
    expect(page1.pageInfo.hasMore).toBe(true);
    expect(page1.pageInfo.nextCursor).toBeDefined();

    const page2 = paginateArray(items, { limit: 3, cursor: page1.pageInfo.nextCursor });
    expect(page2.items).toEqual([4, 5, 6]);
    expect(page2.pageInfo.prevCursor).toBeDefined();

    const page4 = paginateArray(items, { limit: 3, cursor: page2.pageInfo.nextCursor });
    expect(page4.items).toEqual([7, 8, 9]);

    const pageLast = paginateArray(items, { limit: 3, cursor: page4.pageInfo.nextCursor });
    expect(pageLast.items).toEqual([10]);
    expect(pageLast.pageInfo.hasMore).toBe(false);
    expect(pageLast.pageInfo.nextCursor).toBeNull();
  });

  it('GET /api/v1/blockchain/blocks should traverse pages using cursor tokens', async () => {
    // First page
    const res1 = await request(app).get('/api/v1/blockchain/blocks?limit=2');
    expect(res1.status).toBe(200);
    expect(res1.body.data.length).toBeLessThanOrEqual(2);

    const nextCursor = res1.body.meta.pagination.nextCursor;
    if (nextCursor) {
      // Second page with nextCursor
      const res2 = await request(app).get(`/api/v1/blockchain/blocks?limit=2&cursor=${encodeURIComponent(nextCursor)}`);
      expect(res2.status).toBe(200);
      if (res2.body.data.length > 0 && res1.body.data.length > 0) {
        expect(res2.body.data[0].blockNumber).not.toBe(res1.body.data[0].blockNumber);
      }
    }
  });

  it('GET /api/v1/ledger/status should report verified height and consensus readiness', async () => {
    const res = await request(app).get('/api/v1/ledger/status');
    expect(res.status).toBe(200);
    expect(res.body.meta.finality).toBe('FINALIZED');
    expect(res.body.data.isConsensusReady).toBe(true);
    expect(res.body.data.state).toBe('CURRENT');
    expect(res.body.data.heights.finalized).toBeGreaterThanOrEqual(1);
  });
});
