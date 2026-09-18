/**
 * Phase 13 Test Suite: Blockchain & Transaction Events Integration
 */

const fs = require('fs');
const path = require('path');
const Blockchain = require('../src/blockchain/Blockchain');
const Block = require('../src/blockchain/Block');
const Transaction = require('../src/blockchain/Transaction');
const {
  EventStore,
  EventBus,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  FINALITY_STATUS
} = require('../src/events');

describe('Phase 13: Blockchain & Transaction Events Integration', () => {
  const testJournal = path.join(__dirname, 'test_events_blockchain.jsonl');
  let eventStore;
  let eventBus;
  let blockchain;

  beforeEach(async () => {
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
    eventBus = new EventBus();
    eventStore = new EventStore({ filepath: testJournal, eventBus });
    await eventStore.initialize();

    blockchain = new Blockchain();
    blockchain.setEventBus(eventBus);
  });

  afterEach(() => {
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
  });

  test('1. should emit BLOCK_FINALIZED and TRANSACTION_EXECUTED on valid block addition', () => {
    const published = [];
    eventBus.subscribe('*', (ev) => published.push(ev));

    const tx1 = new Transaction({
      sender: 'FPS-001',
      recipient: 'BEN-001',
      type: 'GRAIN_ALLOCATION',
      payload: { quantityKg: 25, commodity: 'Rice' }
    });

    const tx2 = new Transaction({
      sender: 'FPS-001',
      recipient: 'BEN-002',
      type: 'GRAIN_ALLOCATION',
      payload: { quantityKg: 10, commodity: 'Wheat' }
    });

    const block = new Block({
      index: 1,
      blockNumber: 1,
      previousHash: blockchain.getLatestBlock().blockHash,
      transactions: [tx1, tx2],
      timestamp: Date.now()
    });

    blockchain.addBlock(block);

    // Verify events were emitted
    const blockEvents = published.filter(e => e.type === EVENT_TYPES.BLOCK_FINALIZED);
    const txEvents = published.filter(e => e.type === EVENT_TYPES.TRANSACTION_EXECUTED);

    expect(blockEvents.length).toBe(1);
    expect(blockEvents[0].blockHeight).toBe(1);
    expect(blockEvents[0].finalityStatus).toBe(FINALITY_STATUS.FINALIZED);
    expect(blockEvents[0].payload.txCount).toBe(2);

    expect(txEvents.length).toBe(2);
    expect(txEvents[0].finalityStatus).toBe(FINALITY_STATUS.FINALIZED);
    expect(txEvents[0].blockHeight).toBe(1);
    expect(txEvents[0].txHash).toBe(tx1.hash || tx1.transactionId);
    expect(txEvents[1].txHash).toBe(tx2.hash || tx2.transactionId);
  });

  test('2. should persist blockchain events to durable journal file', () => {
    const tx = new Transaction({
      sender: 'FPS-001',
      recipient: 'BEN-003',
      type: 'PDS_DISPATCH',
      payload: { amount: 50 }
    });

    const block = new Block({
      index: 1,
      blockNumber: 1,
      previousHash: blockchain.getLatestBlock().blockHash,
      transactions: [tx],
      timestamp: Date.now()
    });

    blockchain.addBlock(block);

    expect(fs.existsSync(testJournal)).toBe(true);
    const content = fs.readFileSync(testJournal, 'utf8').trim();
    const lines = content.split('\n').filter(Boolean);

    expect(lines.length).toBeGreaterThanOrEqual(2); // At least 1 block + 1 tx
    const parsed = lines.map(l => JSON.parse(l));

    const hasBlockFinalized = parsed.some(e => e.type === EVENT_TYPES.BLOCK_FINALIZED && e.blockHeight === 1);
    const hasTxExecuted = parsed.some(e => e.type === EVENT_TYPES.TRANSACTION_EXECUTED);

    expect(hasBlockFinalized).toBe(true);
    expect(hasTxExecuted).toBe(true);
  });

  test('3. should deduplicate events when replaying or re-submitting identical blocks', () => {
    const tx = new Transaction({
      sender: 'FPS-001',
      recipient: 'BEN-004',
      type: 'PDS_DISPATCH',
      payload: { amount: 15 }
    });

    const block = new Block({
      index: 1,
      blockNumber: 1,
      previousHash: blockchain.getLatestBlock().blockHash,
      transactions: [tx],
      timestamp: Date.now()
    });

    // First emission
    blockchain.addBlock(block);
    const initialCount = eventStore.getTotalCount();

    // Directly attempt to record duplicate block finalized event into EventStore
    const duplicateBlockEvent = eventStore.getEventsByBlock(1)[0];
    const recorded = eventStore.record(duplicateBlockEvent);

    // Should return false due to deduplication key
    expect(recorded).toBe(false);
    expect(eventStore.getTotalCount()).toBe(initialCount);
  });

  test('4. should correctly index block events by block height and block hash', () => {
    const tx = new Transaction({
      sender: 'FPS-001',
      recipient: 'BEN-005',
      type: 'PDS_DISPATCH',
      payload: { amount: 10 }
    });

    const block = new Block({
      index: 1,
      blockNumber: 1,
      previousHash: blockchain.getLatestBlock().blockHash,
      transactions: [tx],
      timestamp: Date.now()
    });

    blockchain.addBlock(block);

    const byHeight = eventStore.getEventsByBlock(1);
    expect(byHeight.length).toBeGreaterThanOrEqual(2);

    const byHash = eventStore.getEventsByBlock(block.blockHash || block.hash);
    expect(byHash.length).toBeGreaterThanOrEqual(2);
  });
});

