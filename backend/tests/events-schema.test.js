/**
 * Phase 13 Test Suite: Event Schema, Validation, Redaction & Bounds Checks
 */

const {
  BlockchainEvent,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS,
  MAX_PAYLOAD_BYTES
} = require('../src/events');

describe('Phase 13: Blockchain Events - Schema & Validation', () => {
  test('1. should instantiate valid BlockchainEvent with defaults', () => {
    const event = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      severity: EVENT_SEVERITIES.INFO,
      finalityStatus: FINALITY_STATUS.FINALIZED,
      blockHeight: 10,
      blockHash: '0xabc123',
      source: 'consensus',
      payload: { blockNumber: 10, txCount: 3 }
    });

    expect(event.eventId).toMatch(/^evt_[a-f0-9]{32}$/);
    expect(event.timestamp).toBeDefined();
    expect(new Date(event.timestamp).getTime()).not.toBeNaN();
    expect(event.schemaVersion).toBe(1);
    expect(event.type).toBe(EVENT_TYPES.BLOCK_FINALIZED);
    expect(event.category).toBe(EVENT_CATEGORIES.BLOCKCHAIN);
    expect(event.severity).toBe(EVENT_SEVERITIES.INFO);
    expect(event.finalityStatus).toBe(FINALITY_STATUS.FINALIZED);
    expect(event.blockHeight).toBe(10);
    expect(event.blockHash).toBe('0xabc123');
    expect(event.payload.blockNumber).toBe(10);
  });

  test('2. should reject invalid event type or category', () => {
    expect(() => {
      BlockchainEvent.create({
        type: 'NON_EXISTENT_TYPE',
        category: EVENT_CATEGORIES.BLOCKCHAIN
      });
    }).toThrow(/Invalid or unknown event type/);

    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_PROPOSED,
        category: 'INVALID_CATEGORY'
      });
    }).toThrow(/Invalid event category/);
  });

  test('3. should reject invalid severity and finality status', () => {
    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_PROPOSED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        severity: 'ULTRA_CRITICAL'
      });
    }).toThrow(/Invalid event severity/);

    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.BLOCK_PROPOSED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        severity: EVENT_SEVERITIES.INFO,
        finalityStatus: 'SUPER_FINALIZED'
      });
    }).toThrow(/Invalid finality status/);
  });

  test('4. should enforce max payload size limit (64KB)', () => {
    const hugeData = 'X'.repeat(MAX_PAYLOAD_BYTES + 100);
    expect(() => {
      BlockchainEvent.create({
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.BLOCKCHAIN,
        payload: { bigField: hugeData }
      });
    }).toThrow(/exceeds maximum allowed size/);
  });

  test('5. should sanitize sensitive fields and secrets from payload recursively', () => {
    const sensitivePayload = {
      user: 'admin',
      privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      nested: {
        password: 'super-secret-password',
        keystorePassword: 'keystore-passphrase',
        authChallenge: '123456',
        secretToken: 'jwt.token.here',
        safeData: 'safeValue'
      },
      arrayData: [
        { seedPhrase: 'twelve secret words that should never appear in log' },
        'regular-item'
      ]
    };

    const event = BlockchainEvent.create({
      type: EVENT_TYPES.KEY_ROTATED,
      category: EVENT_CATEGORIES.KEY_MANAGEMENT,
      payload: sensitivePayload
    });

    const json = event.toJSON();
    expect(json.payload.privateKey).toBe('[REDACTED]');
    expect(json.payload.nested.password).toBe('[REDACTED]');
    expect(json.payload.nested.keystorePassword).toBe('[REDACTED]');
    expect(json.payload.nested.authChallenge).toBe('[REDACTED]');
    expect(json.payload.nested.secretToken).toBe('[REDACTED]');
    expect(json.payload.nested.safeData).toBe('safeValue');
    expect(json.payload.arrayData[0].seedPhrase).toBe('[REDACTED]');
    expect(json.payload.arrayData[1]).toBe('regular-item');

    // Double check stringified output
    const str = JSON.stringify(json);
    expect(str).not.toContain('super-secret-password');
    expect(str).not.toContain('0x0123456789abcdef0123456789abcdef');
    expect(str).not.toContain('twelve secret words');
  });

  test('6. should generate deterministic deduplication keys', () => {
    const blockEvt1 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 42,
      finalityStatus: FINALITY_STATUS.FINALIZED
    });

    const blockEvt2 = BlockchainEvent.create({
      type: EVENT_TYPES.BLOCK_FINALIZED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      blockHeight: 42,
      finalityStatus: FINALITY_STATUS.FINALIZED
    });

    expect(blockEvt1.dedupKey).toBe('BLOCK:42:BLOCK_FINALIZED:FINALIZED');
    expect(blockEvt1.dedupKey).toBe(blockEvt2.dedupKey);

    const txEvt = BlockchainEvent.create({
      type: EVENT_TYPES.TRANSACTION_EXECUTED,
      category: EVENT_CATEGORIES.BLOCKCHAIN,
      txHash: '0xdeadbeef123',
      blockHeight: 42
    });
    expect(txEvt.dedupKey).toBe('TX:0xdeadbeef123:TRANSACTION_EXECUTED:42');
  });

  test('7. should serialize and deserialize via toJSON() and fromJSON()', () => {
    const original = BlockchainEvent.create({
      type: EVENT_TYPES.PEER_CONNECTED,
      category: EVENT_CATEGORIES.NETWORK,
      severity: EVENT_SEVERITIES.INFO,
      source: 'p2p',
      payload: { peerId: 'VAL-02', address: '127.0.0.1:9002' }
    });

    const json = original.toJSON();
    const restored = BlockchainEvent.fromJSON(json);

    expect(restored.eventId).toBe(original.eventId);
    expect(restored.type).toBe(original.type);
    expect(restored.category).toBe(original.category);
    expect(restored.payload.peerId).toBe('VAL-02');
    expect(restored.dedupKey).toBe(original.dedupKey);
  });
});

