/**
 * Phase 13 Test Suite: Consensus, Network & Security Events
 */

const {
  BlockchainEvent,
  EventStore,
  EventBus,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS
} = require('../src/events');

describe('Phase 13: Consensus, Network & Security Events', () => {
  let eventBus;
  let eventStore;

  beforeEach(async () => {
    eventBus = new EventBus();
    eventStore = new EventStore({ inMemoryOnly: true, eventBus });
    await eventStore.initialize();
  });

  afterEach(() => {
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
  });

  test('1. should record consensus proposal and vote events', () => {
    const proposalEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CONSENSUS_PROPOSAL_BROADCAST,
      category: EVENT_CATEGORIES.CONSENSUS,
      severity: EVENT_SEVERITIES.INFO,
      finalityStatus: FINALITY_STATUS.PENDING,
      blockHeight: 5,
      source: 'consensus',
      payload: { proposerId: 'VAL-01', round: 0, blockHash: '0xabc555' }
    });

    const voteEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CONSENSUS_VOTE_CAST,
      category: EVENT_CATEGORIES.CONSENSUS,
      severity: EVENT_SEVERITIES.INFO,
      finalityStatus: FINALITY_STATUS.PENDING,
      blockHeight: 5,
      source: 'consensus',
      payload: { validatorId: 'VAL-01', vote: 'ACCEPT', round: 0 }
    });

    eventStore.record(proposalEvt);
    eventStore.record(voteEvt);

    const consensusEvents = eventStore.query({ category: EVENT_CATEGORIES.CONSENSUS }).events;
    expect(consensusEvents.length).toBe(2);
    expect(consensusEvents.some(e => e.type === EVENT_TYPES.CONSENSUS_PROPOSAL_BROADCAST)).toBe(true);
    expect(consensusEvents.some(e => e.type === EVENT_TYPES.CONSENSUS_VOTE_CAST)).toBe(true);
  });

  test('2. should record consensus certificate formation with finality status', () => {
    const certEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CONSENSUS_CERTIFICATE_FORMED,
      category: EVENT_CATEGORIES.CONSENSUS,
      severity: EVENT_SEVERITIES.INFO,
      finalityStatus: FINALITY_STATUS.FINALIZED,
      blockHeight: 5,
      blockHash: '0xabc555',
      source: 'consensus',
      payload: { blockNumber: 5, signers: ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04'] }
    });

    eventStore.record(certEvt);

    const stored = eventStore.getEventById(certEvt.eventId);
    expect(stored).toBeDefined();
    expect(stored.finalityStatus).toBe(FINALITY_STATUS.FINALIZED);
    expect(stored.payload.signers.length).toBe(4);
  });

  test('3. should record round change events with WARNING severity', () => {
    const roundEvt = BlockchainEvent.create({
      type: EVENT_TYPES.CONSENSUS_ROUND_CHANGED,
      category: EVENT_CATEGORIES.CONSENSUS,
      severity: EVENT_SEVERITIES.WARNING,
      finalityStatus: FINALITY_STATUS.PENDING,
      blockHeight: 5,
      source: 'consensus',
      payload: { oldRound: 0, newRound: 1, reason: 'Proposal timeout' }
    });

    eventStore.record(roundEvt);

    const warnings = eventStore.query({ severity: EVENT_SEVERITIES.WARNING }).events;
    expect(warnings.length).toBe(1);
    expect(warnings[0].type).toBe(EVENT_TYPES.CONSENSUS_ROUND_CHANGED);
    expect(warnings[0].payload.newRound).toBe(1);
  });

  test('4. should record P2P network and TLS security lifecycle events', () => {
    const connectEvt = BlockchainEvent.create({
      type: EVENT_TYPES.PEER_CONNECTED,
      category: EVENT_CATEGORIES.NETWORK,
      severity: EVENT_SEVERITIES.INFO,
      source: 'p2p',
      payload: { peerId: 'VAL-02', remoteAddress: '127.0.0.1:9002' }
    });

    const tlsEvt = BlockchainEvent.create({
      type: EVENT_TYPES.TLS_HANDSHAKE_SUCCEEDED,
      category: EVENT_CATEGORIES.TLS,
      severity: EVENT_SEVERITIES.INFO,
      source: 'tls',
      payload: { peerId: 'VAL-02', cipher: 'TLS_AES_256_GCM_SHA384' }
    });

    const rotateEvt = BlockchainEvent.create({
      type: EVENT_TYPES.KEY_ROTATED,
      category: EVENT_CATEGORIES.KEY_MANAGEMENT,
      severity: EVENT_SEVERITIES.INFO,
      source: 'keystore',
      payload: { validatorId: 'VAL-01', effectiveHeight: 100, newPublicKey: '0xpubkeynew' }
    });

    eventStore.record(connectEvt);
    eventStore.record(tlsEvt);
    eventStore.record(rotateEvt);

    const networkEvts = eventStore.query({ category: EVENT_CATEGORIES.NETWORK }).events;
    const tlsEvts = eventStore.query({ category: EVENT_CATEGORIES.TLS }).events;
    const keyEvts = eventStore.query({ category: EVENT_CATEGORIES.KEY_MANAGEMENT }).events;

    expect(networkEvts.length).toBe(1);
    expect(tlsEvts.length).toBe(1);
    expect(keyEvts.length).toBe(1);
    expect(keyEvts[0].payload.effectiveHeight).toBe(100);
  });
});

