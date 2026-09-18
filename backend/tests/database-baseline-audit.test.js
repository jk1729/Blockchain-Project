/**
 * Phase 18: Database Baseline & Models Test Suite
 */

const { sequelize, Block, Transaction, Receipt, EventRecord, CheckpointRecord, SchemaMigration, DatabaseAuditRecord } = require('../src/models');
const { defaultDatabaseManager } = require('../src/database');

describe('Phase 18: Database Baseline Architecture & Models', () => {
  beforeAll(async () => {
    await defaultDatabaseManager.init();
    await sequelize.sync({ alter: false });
  });

  describe('1. Model Definitions & Structure', () => {
    test('should define all canonical models in models/index.js', () => {
      expect(Block).toBeDefined();
      expect(Transaction).toBeDefined();
      expect(Receipt).toBeDefined();
      expect(EventRecord).toBeDefined();
      expect(CheckpointRecord).toBeDefined();
      expect(SchemaMigration).toBeDefined();
      expect(DatabaseAuditRecord).toBeDefined();
    });

    test('Block model should include receiptsRoot, proposerId, and consensusStatus', () => {
      const attributes = Block.rawAttributes;
      expect(attributes.receiptsRoot).toBeDefined();
      expect(attributes.proposerId).toBeDefined();
      expect(attributes.consensusStatus).toBeDefined();
      expect(attributes.merkleRoot).toBeDefined();
      expect(attributes.stateRoot).toBeDefined();
    });

    test('Receipt model should have transactionHash, logs, and gasUsed fields', () => {
      const attributes = Receipt.rawAttributes;
      expect(attributes.transactionHash).toBeDefined();
      expect(attributes.receiptHash).toBeDefined();
      expect(attributes.gasUsed).toBeDefined();
      expect(attributes.logs).toBeDefined();
      expect(attributes.status).toBeDefined();
    });

    test('EventRecord model should have deduplicationKey and finalityStatus', () => {
      const attributes = EventRecord.rawAttributes;
      expect(attributes.eventId).toBeDefined();
      expect(attributes.deduplicationKey).toBeDefined();
      expect(attributes.finalityStatus).toBeDefined();
      expect(attributes.payload).toBeDefined();
    });
  });

  describe('2. Engine Diagnostics & Health', () => {
    test('defaultDatabaseManager should report HEALTHY status with WAL mode', async () => {
      const isConnected = await defaultDatabaseManager.testConnection();
      expect(isConnected).toBe(true);

      const status = defaultDatabaseManager.getStatus();
      expect(status.status).toBe('HEALTHY');
      expect(status.dialect).toBe('sqlite');
      expect(status.walMode).toBe(true);
      expect(status.pool).toBeDefined();
    });
  });
});

