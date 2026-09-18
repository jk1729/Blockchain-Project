/**
 * Phase 13 Test Suite: EVM Smart Contract Events & Log Decoding
 */

const fs = require('fs');
const path = require('path');
const evmRuntime = require('../src/evm/EVMRuntime');
const contractRegistry = require('../src/evm/ContractRegistry');
const { SYSTEM_EVM_ACCOUNTS } = require('../src/evm/identityBridge');
const {
  EventStore,
  EventBus,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  FINALITY_STATUS
} = require('../src/events');

describe('Phase 13: EVM Smart Contract Events & Log Decoding', () => {
  const testJournal = path.join(__dirname, 'test_events_contract.jsonl');
  let eventStore;
  let eventBus;

  beforeAll(async () => {
    await evmRuntime.initialize();
  });

  beforeEach(async () => {
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
    eventBus = new EventBus();
    eventStore = new EventStore({ filepath: testJournal, eventBus });
    await eventStore.initialize();

    evmRuntime.setEventBus(eventBus);
  });

  afterEach(() => {
    evmRuntime.setEventBus(null);
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
    if (fs.existsSync(testJournal)) {
      fs.unlinkSync(testJournal);
    }
  });

  test('1. should emit CONTRACT_EVENT_EMITTED when contract logs an event', async () => {
    const published = [];
    eventBus.subscribe(EVENT_TYPES.CONTRACT_EVENT_EMITTED, (ev) => published.push(ev));

    const comAddr = contractRegistry.getAddress('CommodityRegistry');
    const receipt = await evmRuntime.executeContractCall({
      transactionId: 'TX-COMMODITY-LOG-01',
      caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
      contractAddress: comAddr,
      method: 'registerCommodity',
      args: ['OrganicBrownRice', 'KG'],
      gasLimit: 500000,
      blockNumber: 10
    });

    expect(receipt.status).toBe('SUCCESS');
    expect(published.length).toBeGreaterThanOrEqual(1);

    const event = published[0];
    expect(event.type).toBe(EVENT_TYPES.CONTRACT_EVENT_EMITTED);
    expect(event.category).toBe(EVENT_CATEGORIES.CONTRACT);
    expect(event.finalityStatus).toBe(FINALITY_STATUS.FINALIZED);
    expect(event.contractAddress).toBe(comAddr.toLowerCase());
    expect(event.txHash).toBe('TX-COMMODITY-LOG-01');
    expect(event.blockHeight).toBe(10);

    // Verify raw topics and payload
    expect(event.payload.rawTopics).toBeDefined();
    expect(Array.isArray(event.payload.rawTopics)).toBe(true);
    expect(event.payload.rawTopics.length).toBeGreaterThan(0);
    expect(event.payload.rawTopics[0]).toMatch(/^0x[a-f0-9]{64}$/i);
    expect(event.payload.rawData).toMatch(/^0x/);

    // Verify decoded event arguments
    expect(event.payload.eventName).toBe('CommodityRegistered');
    expect(event.payload.args).toBeDefined();
    expect(event.payload.args.unit).toBe('KG');
  });

  test('2. should emit CONTRACT_CALL_EXECUTED for successful contract calls', async () => {
    const published = [];
    eventBus.subscribe(EVENT_TYPES.CONTRACT_CALL_EXECUTED, (ev) => published.push(ev));

    const comAddr = contractRegistry.getAddress('CommodityRegistry');
    await evmRuntime.executeContractCall({
      transactionId: 'TX-COMMODITY-CALL-01',
      caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
      contractAddress: comAddr,
      method: 'registerCommodity',
      args: ['RagiFlour', 'KG'],
      gasLimit: 500000,
      blockNumber: 11
    });

    expect(published.length).toBe(1);
    expect(published[0].type).toBe(EVENT_TYPES.CONTRACT_CALL_EXECUTED);
    expect(published[0].payload.method).toBe('registerCommodity');
    expect(published[0].payload.gasUsed).toBeGreaterThan(0);
  });

  test('3. should emit CONTRACT_CALL_FAILED on revert with decoded reason', async () => {
    const published = [];
    eventBus.subscribe(EVENT_TYPES.CONTRACT_CALL_FAILED, (ev) => published.push(ev));

    const comAddr = contractRegistry.getAddress('CommodityRegistry');
    // Registering duplicate commodity name will revert in contract
    await evmRuntime.executeContractCall({
      transactionId: 'TX-DUP-01',
      caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
      contractAddress: comAddr,
      method: 'registerCommodity',
      args: ['DuplicateGrain', 'KG'],
      gasLimit: 500000,
      blockNumber: 12
    });

    const revertReceipt = await evmRuntime.executeContractCall({
      transactionId: 'TX-DUP-02',
      caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
      contractAddress: comAddr,
      method: 'registerCommodity',
      args: ['DuplicateGrain', 'KG'],
      gasLimit: 500000,
      blockNumber: 13
    });

    expect(revertReceipt.status).toBe('REVERT');
    expect(published.length).toBe(1);
    expect(published[0].type).toBe(EVENT_TYPES.CONTRACT_CALL_FAILED);
    expect(published[0].txHash).toBe('TX-DUP-02');
    expect(published[0].blockHeight).toBe(13);
    expect(published[0].payload.reason).toBeDefined();
  });

  test('4. should correctly index and query events by contract address in EventStore', async () => {
    const comAddr = contractRegistry.getAddress('CommodityRegistry');
    await evmRuntime.executeContractCall({
      transactionId: 'TX-STORE-CHECK-01',
      caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
      contractAddress: comAddr,
      method: 'registerCommodity',
      args: ['Bajra', 'KG'],
      gasLimit: 500000,
      blockNumber: 14
    });

    const contractEvents = eventStore.getEventsByContract(comAddr);
    expect(contractEvents.length).toBeGreaterThan(0);
    expect(contractEvents.every(e => e.contractAddress.toLowerCase() === comAddr.toLowerCase())).toBe(true);
  });
});

