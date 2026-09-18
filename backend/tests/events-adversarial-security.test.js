/**
 * Phase 13 Test Suite: Adversarial Security, Secret Privacy & Query Hardening
 */

const {
  BlockchainEvent,
  EventStore,
  EventBus,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS,
  MAX_PAYLOAD_BYTES
} = require('../src/events');

describe('Phase 13: Adversarial Security, Secret Privacy & Query Hardening', () => {
  let eventStore;
  let eventBus;

  beforeEach(async () => {
    eventBus = new EventBus();
    eventStore = new EventStore({ inMemoryOnly: true, eventBus, maxMemoryEvents: 50 });
    await eventStore.initialize();
  });

  afterEach(() => {
    if (eventStore) eventStore.close();
    if (eventBus) eventBus.clear();
  });

  test('1. Secret Privacy Audit: ensure complete redaction of all sensitive keys and passphrases', () => {
    const leakedSecrets = {
      privateKey: '0x39a1c8...',
      privKey: '0xabcdef...',
      password: 'MyMasterPassword123!',
      passphrase: 'super secret phrase',
      secret: 'consensus-secret-key',
      authChallenge: 'challenge-nonce-xyz',
      jwtToken: 'eyJhbGciOi...',
      seed: 'twelve words mnemonic seed here',
      bearer: 'bearer-token-1234'
    };

    const event = BlockchainEvent.create({
      type: EVENT_TYPES.KEY_ROTATED,
      category: EVENT_CATEGORIES.KEY_MANAGEMENT,
      payload: leakedSecrets
    });

    const serialized = JSON.stringify(event.toJSON());
    for (const [key, val] of Object.entries(leakedSecrets)) {
      expect(serialized).not.toContain(val);
    }
  });

  test('2. Query Injection Hardening: sanitize malicious and prototype-polluting query parameters', () => {
    const maliciousQueries = [
      { limit: "10; DROP TABLE events;" },
      { fromBlock: "' OR '1'='1" },
      { category: { "$ne": null } },
      { __proto__: { admin: true } },
      { limit: -5 },
      { limit: 9999999 }
    ];

    for (const q of maliciousQueries) {
      expect(() => {
        const res = eventStore.query(q);
        expect(res).toBeDefined();
        expect(Array.isArray(res.events)).toBe(true);
        expect(res.events.length).toBeLessThanOrEqual(1000);
      }).not.toThrow();
    }
  });

  test('3. Forged Event Rejection: cannot construct BlockchainEvent with invalid attributes', () => {
    expect(() => {
      BlockchainEvent.create({
        type: 'FORGED_CONSENSUS_TYPE',
        category: EVENT_CATEGORIES.CONSENSUS
      });
    }).toThrow(/Invalid or unknown event type/);

    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_FINALIZED,
        category: 'FORGED_CATEGORY'
      });
    }).toThrow(/Invalid event category/);

    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_FINALIZED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        severity: 'EXPLOIT'
      });
    }).toThrow(/Invalid event severity/);
  });

  test('4. Payload Flooding / Rejection: payload exceeding 64KB is strictly rejected', () => {
    const massivePayload = {
      junk: 'A'.repeat(MAX_PAYLOAD_BYTES + 50)
    };

    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        payload: massivePayload
      });
    }).toThrow(/exceeds maximum allowed size/);
  });

  test('5. Bounded Memory Eviction: EventStore caps maximum in-memory events to prevent OOM', () => {
    for (let i = 1; i <= 80; i++) {
      eventStore.record(BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_FINALIZED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        blockHeight: i
      }));
    }

    // Capacity was configured to 50
    expect(eventStore.events.length).toBeLessThanOrEqual(50);
  });
});

