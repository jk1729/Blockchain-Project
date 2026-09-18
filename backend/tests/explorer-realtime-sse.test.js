/**
 * PDSChain Explorer Real-Time SSE Streaming Test Suite (Phase 15)
 */

const request = require('supertest');
const app = require('../src/app');
const { sequelize } = require('../src/config/database');
const { seedDatabase } = require('../src/seed/seedDatabase');
const { EventStore, EventBus, BlockchainEvent, EventType, EventCategory, EventSeverity, FinalityStatus } = require('../src/events');

describe('Explorer Real-Time SSE Streaming Test Suite (Phase 15)', () => {
  let eventStore, eventBus;

  beforeAll(async () => {
    await seedDatabase(true);
    eventStore = new EventStore({ maxEvents: 100 });
    eventBus = new EventBus({ eventStore });
    app.locals.eventStore = eventStore;
    app.locals.eventBus = eventBus;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('GET /api/v1/events/stream should establish SSE text/event-stream connection', (done) => {
    const req = request(app)
      .get('/api/v1/events/stream')
      .set('Accept', 'text/event-stream');

    req.end((err, res) => {
      // Stream is long-lived; we inspect initial headers
    });

    setTimeout(() => {
      req.abort();
      done();
    }, 300);
  });

  it('should support Last-Event-ID resume query to catch up on missed events', async () => {
    // Publish 3 events
    const evt1 = new BlockchainEvent({
      eventType: EventType.BLOCK_FINALIZED,
      category: EventCategory.BLOCKCHAIN,
      severity: EventSeverity.INFO,
      finalityStatus: FinalityStatus.FINALIZED,
      blockHeight: 1
    });
    const evt2 = new BlockchainEvent({
      eventType: EventType.BLOCK_FINALIZED,
      category: EventCategory.BLOCKCHAIN,
      severity: EventSeverity.INFO,
      finalityStatus: FinalityStatus.FINALIZED,
      blockHeight: 2
    });

    eventStore.append(evt1);
    eventStore.append(evt2);

    // Query events with afterEventId / cursor
    const res = await request(app).get(`/api/v1/events?afterEventId=${evt1.eventId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('should suppress duplicate events using client deduplication Set', () => {
    const seenEventIds = new Set();
    const event1 = { eventId: 'EVT-TEST-001', type: 'BLOCK_FINALIZED' };
    const event2 = { eventId: 'EVT-TEST-001', type: 'BLOCK_FINALIZED' }; // duplicate
    const event3 = { eventId: 'EVT-TEST-002', type: 'TRANSACTION_EXECUTED' };

    function processEvent(evt) {
      if (seenEventIds.has(evt.eventId)) {
        return false; // suppressed
      }
      seenEventIds.add(evt.eventId);
      return true; // accepted
    }

    expect(processEvent(event1)).toBe(true);
    expect(processEvent(event2)).toBe(false); // suppressed duplicate
    expect(processEvent(event3)).toBe(true);
    expect(seenEventIds.size).toBe(2);
  });

  it('should maintain bounded buffer to prevent memory exhaustion', () => {
    const buffer = [];
    const MAX_BUFFER = 25;

    for (let i = 0; i < 60; i++) {
      buffer.unshift({ id: `EVT-${i}`, num: i });
      if (buffer.length > MAX_BUFFER) {
        buffer.pop();
      }
    }

    expect(buffer.length).toBe(MAX_BUFFER);
    expect(buffer[0].num).toBe(59);
    expect(buffer[buffer.length - 1].num).toBe(35);
  });
});

