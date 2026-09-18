/**
 * Phase 13 Test Suite: EventBus Pub/Sub & Real-time Streaming (SSE)
 */

const {
  BlockchainEvent,
  EventStore,
  EventBus,
  EventStreamManager,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS
} = require('../src/events');

describe('Phase 13: EventBus Pub/Sub & Real-time Streaming (SSE)', () => {
  let eventStore;
  let eventBus;
  let streamManager;

  beforeEach(async () => {
    eventBus = new EventBus();
    eventStore = new EventStore({ inMemoryOnly: true, eventBus });
    await eventStore.initialize();
    streamManager = new EventStreamManager({ eventStore, eventBus });
  });

  afterEach(() => {
    if (streamManager) streamManager.closeAll();
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
  });

  test('1. should support wildcard and specific topic subscriptions', () => {
    const wildcardReceived = [];
    const blockReceived = [];

    eventBus.subscribe('*', (ev) => wildcardReceived.push(ev));
    eventBus.subscribe(EVENT_TYPES.BLOCK_FINALIZED, (ev) => blockReceived.push(ev));

    const blockEvt = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1
    });

    const txEvt = BlockchainEvent.create({
      type: EVENT_TYPES.TRANSACTION_EXECUTED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      txHash: '0xabc'
    });

    eventBus.publish(blockEvt);
    eventBus.publish(txEvt);

    expect(wildcardReceived.length).toBe(2);
    expect(blockReceived.length).toBe(1);
    expect(blockReceived[0].eventId).toBe(blockEvt.eventId);
  });

  test('2. should isolate subscriber errors without interrupting other subscribers', () => {
    const successfulSubscriber = [];

    // Failing subscriber
    eventBus.subscribe(EVENT_TYPES.BLOCK_FINALIZED, () => {
      throw new Error('Subscriber exploded');
    });

    // Good subscriber
    eventBus.subscribe(EVENT_TYPES.BLOCK_FINALIZED, (ev) => {
      successfulSubscriber.push(ev);
    });

    const blockEvt = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 2
    });

    // Publishing should not throw
    expect(() => {
      eventBus.publish(blockEvt);
    }).not.toThrow();

    expect(successfulSubscriber.length).toBe(1);
  });

  test('3. should support unsubscribe cleanly', () => {
    let callCount = 0;
    const unsub = eventBus.subscribe('TEST_EVT', () => {
      callCount++;
    });

    expect(eventBus.getSubscriberCount('TEST_EVT')).toBe(1);

    eventBus.publish(BlockchainEvent.create({
      type: 'BLOCK_PROPOSED',
      category: EVENT_CATEGORIES.BLOCKCHAIN
    }));

    unsub();
    expect(eventBus.getSubscriberCount('TEST_EVT')).toBe(0);
  });

  test('4. should stream events to SSE client matching subscription filters', () => {
    const writtenData = [];
    const mockRes = {
      write: jest.fn((chunk) => writtenData.push(chunk)),
      end: jest.fn(),
      on: jest.fn()
    };

    const client = streamManager.registerClient(mockRes, {
      category: EVENT_CATEGORIES.CONTRACT,
      contractAddress: '0x1234567890123456789012345678901234567890'
    });

    expect(streamManager.getActiveClientCount()).toBe(1);

    // Publish matching contract event
    const matchingEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CONTRACT_EVENT_EMITTED,
      category: EVENT_CATEGORIES.CONTRACT,
      contractAddress: '0x1234567890123456789012345678901234567890',
      payload: { name: 'TokensIssued' }
    });

    // Publish non-matching blockchain event
    const nonMatchingEvt = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1
    });

    eventBus.publish(matchingEvt);
    eventBus.publish(nonMatchingEvt);

    expect(mockRes.write).toHaveBeenCalled();
    const joinedOutput = writtenData.join('');
    expect(joinedOutput).toContain(matchingEvt.eventId);
    expect(joinedOutput).toContain('TokensIssued');
    expect(joinedOutput).not.toContain(nonMatchingEvt.eventId);
  });

  test('5. should replay missed events on client reconnect with Last-Event-ID', () => {
    // Record 3 events in store
    const evt1 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1
    });
    const evt2 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 2
    });
    const evt3 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 3
    });

    eventStore.record(evt1);
    eventStore.record(evt2);
    eventStore.record(evt3);

    const writtenData = [];
    const mockRes = {
      write: jest.fn((chunk) => writtenData.push(chunk)),
      end: jest.fn(),
      on: jest.fn()
    };

    // Client reconnects specifying Last-Event-ID of evt1
    streamManager.registerClient(mockRes, {}, evt1.eventId);

    const joinedOutput = writtenData.join('');
    expect(joinedOutput).not.toContain(evt1.eventId); // Should not replay already received evt1
    expect(joinedOutput).toContain(evt2.eventId);     // Should replay evt2
    expect(joinedOutput).toContain(evt3.eventId);     // Should replay evt3
  });

  test('6. should disconnect slow or stalled SSE clients beyond buffer threshold', () => {
    const mockRes = {
      write: jest.fn(() => false), // returns false indicating buffer full / backpressure
      end: jest.fn(),
      on: jest.fn()
    };

    const client = streamManager.registerClient(mockRes, {});
    // Simulate exceeding max buffered messages
    client.bufferedMessages = 1005;

    const evt = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 10
    });

    eventBus.publish(evt);

    expect(mockRes.end).toHaveBeenCalled();
    expect(streamManager.getActiveClientCount()).toBe(0);
  });
});
