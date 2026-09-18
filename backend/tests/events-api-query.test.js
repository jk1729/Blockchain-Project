/**
 * Phase 13 Test Suite: Event Query REST APIs & Prometheus Metrics
 */

const express = require('express');
const request = require('supertest');
const {
  BlockchainEvent,
  EventStore,
  EventBus,
  EventStreamManager,
  EventMetrics,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS
} = require('../src/events');
const eventRoutes = require('../src/routes/eventRoutes');

describe('Phase 13: Event Query REST APIs & Prometheus Metrics', () => {
  let app;
  let eventStore;
  let eventBus;
  let streamManager;
  let eventMetrics;

  beforeEach(async () => {
    eventBus = new EventBus();
    eventStore = new EventStore({ inMemoryOnly: true, eventBus });
    await eventStore.initialize();
    streamManager = new EventStreamManager({ eventStore, eventBus });
    eventMetrics = new EventMetrics(eventBus);

    app = express();
    app.use(express.json());
    app.locals.eventStore = eventStore;
    app.locals.eventBus = eventBus;
    app.locals.streamManager = streamManager;
    app.locals.eventMetrics = eventMetrics;

    app.use('/api/events', eventRoutes);

    // Seed events
    for (let i = 1; i <= 15; i++) {
      eventStore.record(BlockchainEvent.create({
        type: i % 2 === 0 ? EVENT_TYPES.BLOCK_FINALIZED : EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        severity: EVENT_SEVERITIES.INFO,
        finalityStatus: FINALITY_STATUS.FINALIZED,
        blockHeight: Math.ceil(i / 2),
        txHash: i % 2 !== 0 ? `0xtx${i}` : null,
        contractAddress: i === 5 ? '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' : null,
        payload: { index: i }
      }));
    }
  });

  afterEach(() => {
    if (streamManager) streamManager.closeAll();
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
  });

  test('1. GET /api/events should return paginated list of events', async () => {
    const res = await request(app).get('/api/events?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events.length).toBe(5);
    expect(res.body.total).toBe(15);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBeDefined();
  });

  test('2. GET /api/events should support cursor pagination', async () => {
    const res1 = await request(app).get('/api/events?limit=5');
    expect(res1.body.events.length).toBe(5);
    const nextCursor = res1.body.nextCursor;

    const res2 = await request(app).get(`/api/events?limit=5&cursor=${nextCursor}`);
    expect(res2.status).toBe(200);
    expect(res2.body.events.length).toBe(5);
    expect(res2.body.events[0].eventId).not.toBe(res1.body.events[0].eventId);
  });

  test('3. GET /api/events should filter by block range (fromBlock, toBlock)', async () => {
    const res = await request(app).get('/api/events?fromBlock=2&toBlock=3');
    expect(res.status).toBe(200);
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events.every(e => e.blockHeight >= 2 && e.blockHeight <= 3)).toBe(true);
  });

  test('4. GET /api/events/:eventId should return single event or 404', async () => {
    const all = eventStore.query({ limit: 1 }).events;
    const targetId = all[0].eventId;

    const res = await request(app).get(`/api/events/${targetId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event.eventId).toBe(targetId);

    const notFound = await request(app).get('/api/events/evt_nonexistent1234567890abcdef');
    expect(notFound.status).toBe(404);
  });

  test('5. GET /api/events/blocks/:heightOrHash should return events for that block', async () => {
    const res = await request(app).get('/api/events/blocks/2');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events.every(e => e.blockHeight === 2)).toBe(true);
  });

  test('6. GET /api/events/transactions/:txHash should return events for that transaction', async () => {
    const res = await request(app).get('/api/events/transactions/0xtx3');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].txHash).toBe('0xtx3');
  });

  test('7. GET /api/events/contracts/:address should return events for that contract', async () => {
    const res = await request(app).get('/api/events/contracts/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].contractAddress).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
  });

  test('8. GET /api/events/metrics should return telemetry in JSON and text formats', async () => {
    const jsonRes = await request(app).get('/api/events/metrics');
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.body.success).toBe(true);
    expect(jsonRes.body.metrics).toBeDefined();
    expect(jsonRes.body.metrics.totalEventsEmitted).toBeGreaterThanOrEqual(15);

    const textRes = await request(app)
      .get('/api/events/metrics')
      .set('Accept', 'text/plain');
    expect(textRes.status).toBe(200);
    expect(textRes.text).toContain('pdschain_events_emitted_total');
  });
});

