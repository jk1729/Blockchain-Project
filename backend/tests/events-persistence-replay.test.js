/**
 * Phase 13 Test Suite: Event Persistence, Journal Replay & Corruption Recovery
 */

const fs = require('fs');
const path = require('path');
const {
  BlockchainEvent,
  EventStore,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS
} = require('../src/events');

describe('Phase 13: Event Persistence, Journal Replay & Corruption Recovery', () => {
  const testJournal = path.join(__dirname, 'test_events_persistence.jsonl');

  beforeEach(() => {
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
  });

  afterEach(() => {
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
  });

  test('1. should persist events to append-only journal and rebuild in-memory state on reload', async () => {
    // 1. Create and populate store
    let store = new EventStore({ filepath: testJournal });
    await store.initialize();

    const evt1 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1,
      payload: { txCount: 2 }
    });

    const evt2 = BlockchainEvent.create({
      type: EVENT_TYPES.TRANSACTION_EXECUTED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1,
      txHash: '0x123abc',
      payload: { success: true }
    });

    store.record(evt1);
    store.record(evt2);
    expect(store.getTotalCount()).toBe(2);
    store.close();

    // 2. Re-open store from same file
    let reloadedStore = new EventStore({ filepath: testJournal });
    await reloadedStore.initialize();

    expect(reloadedStore.getTotalCount()).toBe(2);
    const byBlock = reloadedStore.getEventsByBlock(1);
    expect(byBlock.length).toBe(2);
    const byTx = reloadedStore.getEventsByTx('0x123abc');
    expect(byTx.length).toBe(1);
    expect(byTx[0].eventId).toBe(evt2.eventId);

    reloadedStore.close();
  });

  test('2. should gracefully quarantine corrupt lines without failing overall journal recovery', async () => {
    // Write valid event, corrupt line, valid event
    const validEvt1 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 1
    });

    const validEvt2 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 2
    });

    const lines = [
      JSON.stringify(validEvt1.toJSON()),
      '{ corrupted json line without closing bracket: 123 ',
      JSON.stringify(validEvt2.toJSON())
    ];

    fs.writeFileSync(testJournal, lines.join('\n') + '\n', 'utf8');

    const store = new EventStore({ filepath: testJournal });
    const recoveryResult = await store.initialize();

    expect(recoveryResult.loaded).toBe(2);
    expect(recoveryResult.corruptLines).toBe(1);
    expect(store.getTotalCount()).toBe(2);
    expect(store.getEventsByBlock(1).length).toBe(1);
    expect(store.getEventsByBlock(2).length).toBe(1);

    store.close();
  });

  test('3. should avoid re-appending duplicate events during journal replay', async () => {
    const store = new EventStore({ filepath: testJournal });
    await store.initialize();

    const evt = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 5
    });

    store.record(evt);
    const fileBytesBefore = fs.statSync(testJournal).size;

    // Simulate calling replay on existing store
    await store.replay();

    const fileBytesAfter = fs.statSync(testJournal).size;
    expect(fileBytesAfter).toBe(fileBytesBefore); // File size did not grow
    expect(store.getTotalCount()).toBe(1);

    store.close();
  });

  test('4. should rebuild indexes correctly', async () => {
    const store = new EventStore({ filepath: testJournal });
    await store.initialize();

    for (let i = 1; i <= 5; i++) {
      store.record(BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_FINALIZED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        blockHeight: i
      }));
    }

    expect(store.getTotalCount()).toBe(5);
    store.rebuildIndexes();

    expect(store.getTotalCount()).toBe(5);
    expect(store.getEventsByBlock(3).length).toBe(1);

    store.close();
  });
});

