const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventStore, BlockchainEvent, EVENT_TYPES, EVENT_CATEGORIES } = require('../src/events');
const { SecurityAuditLogger } = require('../src/security/permissions/SecurityAuditLogger');

describe('Security & Consistency: EventStore Collision & Denial Audit Reliability', () => {
  let tmpDir;
  let eventJournalPath;
  let auditLogPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdschain-collision-test-'));
    eventJournalPath = path.join(tmpDir, 'events.jsonl');
    auditLogPath = path.join(tmpDir, 'audit.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('EventStore Same-ID Collision Detection', () => {
    test('1. should idempotently accept event with identical eventId and identical payload', () => {
      const store = new EventStore({ filepath: eventJournalPath });
      const event1 = BlockchainEvent.create({
        eventId: 'ev-test-unique-001',
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.TRANSACTION,
        payload: { transferId: 'TRF-001', amount: 100 }
      });

      const appended1 = store.append(event1);
      expect(appended1.eventId).toBe('ev-test-unique-001');

      // Attempt to append identical event with same ID
      const event1Copy = BlockchainEvent.create({
        eventId: 'ev-test-unique-001',
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.TRANSACTION,
        payload: { transferId: 'TRF-001', amount: 100 }
      });

      const appended2 = store.append(event1Copy);
      expect(appended2.eventId).toBe('ev-test-unique-001');
      expect(store.getTotalCount()).toBe(1);
    });

    test('2. should reject same-ID event when payload is materially conflicting', () => {
      const store = new EventStore({ filepath: eventJournalPath });
      const event1 = BlockchainEvent.create({
        eventId: 'ev-test-collision-001',
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.TRANSACTION,
        payload: { transferId: 'TRF-001', amount: 100 }
      });

      store.append(event1);

      // Create an event with the SAME eventId but conflicting payload
      const conflictingEvent = BlockchainEvent.create({
        eventId: 'ev-test-collision-001',
        type: EVENT_TYPES.TRANSACTION_EXECUTED,
        category: EVENT_CATEGORIES.TRANSACTION,
        payload: { transferId: 'TRF-001', amount: 99999, maliciousOverride: true }
      });

      expect(() => {
        store.append(conflictingEvent);
      }).toThrow(/Collision detected: Event ID 'ev-test-collision-001' already exists with conflicting payload/);

      // Verify record() returns false and stores lastPersistenceError
      const recordResult = store.record(conflictingEvent);
      expect(recordResult).toBe(false);
      expect(store.lastPersistenceError).toBeDefined();
      expect(store.lastPersistenceError.code).toBe('ERR_EVENT_COLLISION');

      // Original event must remain intact
      const retrieved = store.getEvent('ev-test-collision-001');
      expect(retrieved.payload.amount).toBe(100);
      expect(retrieved.payload.maliciousOverride).toBeUndefined();
    });
  });

  describe('SecurityAuditLogger Collision & Denial Audit Reliability', () => {
    test('3. should reject same-ID audit event with conflicting payload', () => {
      const auditLogger = new SecurityAuditLogger({ filepath: auditLogPath });

      auditLogger.logEvent({
        eventId: 'audit-fixed-id-100',
        actorId: 'operator1',
        action: 'warehouse_transfer',
        resource: 'WH-001',
        decision: 'ALLOW',
        reason: 'Authorized'
      });

      expect(() => {
        auditLogger.logEvent({
          eventId: 'audit-fixed-id-100',
          actorId: 'operator1',
          action: 'warehouse_transfer',
          resource: 'WH-002', // Conflicting resource
          decision: 'DENY',   // Conflicting decision
          reason: 'Tampered collision attempt'
        });
      }).toThrow(/Collision detected: Audit event ID 'audit-fixed-id-100' already exists/);
    });

    test('4. should log denial audits, preserve cryptographic chain integrity, and sanitize secrets', () => {
      const auditLogger = new SecurityAuditLogger({ filepath: auditLogPath });

      // Log an allow event
      auditLogger.logEvent({
        actorId: 'admin',
        action: 'system_config',
        resource: 'GLOBAL',
        decision: 'ALLOW',
        reason: 'Authorized config change'
      });

      // Log a denial event with sensitive fields that must be redacted
      const denial = auditLogger.logEvent({
        actorId: 'rogue_user',
        actorType: 'CLIENT',
        action: 'warehouse_transfer',
        resource: 'WH-003',
        decision: 'DENY',
        reason: 'Warehouse operator is not authorized for this warehouse',
        details: {
          password: 'SecretPassword123!',
          privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          targetWarehouse: 'WH-003'
        }
      });

      expect(denial.decision).toBe('DENY');
      // Verify secret sanitization
      expect(denial.details.password).toBe('[REDACTED]');
      expect(denial.details.privateKey).toBe('[REDACTED]');
      expect(denial.details.targetWarehouse).toBe('WH-003');

      // Verify audit hash chain integrity
      const integrity = auditLogger.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.count).toBe(2);

      // Verify file persistence matches in-memory
      const fileLines = fs.readFileSync(auditLogPath, 'utf8').trim().split('\n');
      expect(fileLines.length).toBe(2);
      const parsedFileEntry = JSON.parse(fileLines[1]);
      expect(parsedFileEntry.decision).toBe('DENY');
      expect(parsedFileEntry.details.password).toBe('[REDACTED]');
    });
  });
});

