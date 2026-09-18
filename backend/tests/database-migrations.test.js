/**
 * Phase 18: Database Migration Framework Test Suite
 */

const { DatabaseMigrationManager, MigrationError } = require('../src/database/DatabaseMigrationManager');
const { SchemaMigration } = require('../src/models');
const { defaultDatabaseManager } = require('../src/database');

describe('Phase 18: Database Migration Framework', () => {
  let migrationManager;

  beforeAll(async () => {
    await defaultDatabaseManager.init();
    migrationManager = new DatabaseMigrationManager();
    await migrationManager.ensureMigrationTable();
  });

  beforeEach(async () => {
    const { Op } = require('sequelize');
    await SchemaMigration.destroy({ where: { version: { [Op.gte]: 9000 } } });
  });

  afterAll(async () => {
    const { Op } = require('sequelize');
    await SchemaMigration.destroy({ where: { version: { [Op.gte]: 9000 } } });
  });

  describe('1. Checksum & Idempotency', () => {
    test('should compute deterministic SHA-256 checksum for migration', () => {
      const script = 'async function up() { return true; }';
      const c1 = migrationManager.computeChecksum(script);
      const c2 = migrationManager.computeChecksum(script);
      expect(c1).toBe(c2);
      expect(c1.length).toBe(64);
    });

    test('should apply a migration successfully and record in schema_migrations', async () => {
      const version = 9001;
      const migration = {
        version,
        name: 'test_migration_apply',
        up: async () => true,
        down: async () => true
      };

      const result = await migrationManager.applyMigration(migration);
      expect(result.success).toBe(true);
      expect(result.version).toBe(version);

      const record = await SchemaMigration.findOne({ where: { version } });
      expect(record).not.toBeNull();
      expect(record.name).toBe('test_migration_apply');
    });

    test('should skip already-applied migration without error (idempotency)', async () => {
      const version = 9001;
      const migration = {
        version,
        name: 'test_migration_apply',
        up: async () => true,
        down: async () => true
      };

      await migrationManager.applyMigration(migration);
      const result = await migrationManager.applyMigration(migration);
      expect(result.skipped).toBe(true);
    });
  });

  describe('2. Dry Run & Lock Protection', () => {
    test('dryRun should validate migration without writing to schema_migrations', async () => {
      const version = 9002;
      const migration = {
        version,
        name: 'test_migration_dryrun',
        up: async () => true
      };

      const result = await migrationManager.applyMigration(migration, { dryRun: true });
      expect(result.dryRun).toBe(true);

      const record = await SchemaMigration.findOne({ where: { version } });
      expect(record).toBeNull();
    });

    test('should reject concurrent migration execution if locked', async () => {
      migrationManager.isLocked = true;
      const migration = {
        version: 9003,
        name: 'locked_migration',
        up: async () => true
      };

      await expect(migrationManager.applyMigration(migration)).rejects.toThrow(MigrationError);
      await expect(migrationManager.applyMigration(migration)).rejects.toThrow('Migration lock already acquired');

      migrationManager.isLocked = false;
    });
  });

  describe('3. Schema Validation & Integrity', () => {
    test('validateSchema should report error if an applied migration checksum differs', async () => {
      const version = 9004;
      await SchemaMigration.create({
        version,
        name: 'tampered_migration',
        checksum: 'original_checksum_123',
        executionTimeMs: 10,
        appliedBy: 'TEST',
        appliedAt: new Date()
      });

      const available = [
        {
          version,
          name: 'tampered_migration',
          checksum: 'modified_different_checksum',
          up: async () => true
        }
      ];

      const validation = await migrationManager.validateSchema(available);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(e => e.includes('checksum mismatch'))).toBe(true);
    });
  });
});
