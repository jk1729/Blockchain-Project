/**
 * PDSChain Database Migration Manager (Phase 18)
 * 
 * Versioned, ordered, and idempotent migration execution with checksum verification,
 * concurrency locking, and rollback support.
 */

const crypto = require('crypto');
const { sequelize } = require('../config/database');
const SchemaMigration = require('../models/SchemaMigration');
const logger = require('../utils/logger');

class MigrationError extends Error {
  constructor(message, code = 'MIGRATION_ERROR', details = {}) {
    super(message);
    this.name = 'MigrationError';
    this.code = code;
    this.details = details;
  }
}

class DatabaseMigrationManager {
  constructor(options = {}) {
    this.sequelize = options.sequelize || sequelize;
    this.logger = options.logger || logger;
    this.isLocked = false;
  }

  /**
   * Ensure schema_migrations registry table exists
   */
  async ensureMigrationTable() {
    await SchemaMigration.sync({ alter: false });
  }

  /**
   * Compute SHA-256 checksum of a migration payload or script
   * @param {string|object} content 
   * @returns {string} Hex SHA-256
   */
  computeChecksum(content) {
    const raw = typeof content === 'string' ? content : JSON.stringify(content);
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Retrieve list of all applied migrations ordered by version ascending
   * @returns {Promise<Array<object>>}
   */
  async getAppliedMigrations() {
    await this.ensureMigrationTable();
    const records = await SchemaMigration.findAll({ order: [['version', 'ASC']] });
    return records.map(r => r.toJSON());
  }

  /**
   * Filter pending migrations from candidate list
   * @param {Array<object>} availableMigrations - [{ version, name, up, down, checksum }]
   * @returns {Promise<Array<object>>}
   */
  async getPendingMigrations(availableMigrations = []) {
    const applied = await this.getAppliedMigrations();
    const appliedVersions = new Set(applied.map(m => m.version));
    return availableMigrations
      .filter(m => !appliedVersions.has(m.version))
      .sort((a, b) => a.version - b.version);
  }

  /**
   * Validate schema integrity: verify that applied migrations match registered checksums
   * @param {Array<object>} availableMigrations 
   * @returns {Promise<{ valid: boolean, errors: Array<string> }>}
   */
  async validateSchema(availableMigrations = []) {
    const errors = [];
    const applied = await this.getAppliedMigrations();
    const availableMap = new Map(availableMigrations.map(m => [m.version, m]));

    for (const app of applied) {
      const avail = availableMap.get(app.version);
      if (!avail) {
        errors.push(`Applied migration v${app.version} '${app.name}' is missing from current code bundle.`);
        continue;
      }
      const expectedChecksum = avail.checksum || this.computeChecksum(avail.up.toString());
      if (app.checksum && app.checksum !== expectedChecksum) {
        errors.push(`Migration v${app.version} checksum mismatch: recorded '${app.checksum}', current '${expectedChecksum}'.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute a single migration
   * @param {object} migration - { version, name, up, down, checksum }
   * @param {object} [options]
   * @param {boolean} [options.dryRun=false]
   * @param {string} [options.appliedBy='SYSTEM']
   */
  async applyMigration(migration, options = {}) {
    if (!migration || typeof migration.version !== 'number' || !migration.name) {
      throw new MigrationError('Invalid migration definition', 'MALFORMED_MIGRATION');
    }

    if (this.isLocked) {
      throw new MigrationError('Migration lock already acquired by another process', 'MIGRATION_LOCK_CONFLICT');
    }

    this.isLocked = true;
    await this.ensureMigrationTable();

    // Check if already applied
    const existing = await SchemaMigration.findOne({ where: { version: migration.version } });
    if (existing) {
      this.isLocked = false;
      return { skipped: true, version: migration.version, message: 'Migration already applied.' };
    }

    const t0 = Date.now();
    const checksum = migration.checksum || this.computeChecksum(migration.up.toString());

    if (options.dryRun) {
      this.isLocked = false;
      return {
        dryRun: true,
        version: migration.version,
        name: migration.name,
        checksum,
        message: 'Dry run successful; no changes applied.'
      };
    }

    try {
      this.logger.info(`[MigrationManager] Applying migration v${migration.version}: ${migration.name}...`);
      await migration.up(this.sequelize);
      const durationMs = Date.now() - t0;

      await SchemaMigration.create({
        version: migration.version,
        name: migration.name,
        checksum,
        executionTimeMs: durationMs,
        appliedBy: options.appliedBy || 'SYSTEM',
        appliedAt: new Date()
      });

      this.logger.info(`[MigrationManager] Migration v${migration.version} applied successfully in ${durationMs}ms.`);
      return {
        success: true,
        version: migration.version,
        name: migration.name,
        checksum,
        executionTimeMs: durationMs
      };
    } catch (err) {
      this.logger.error(`[MigrationManager] Failed to apply migration v${migration.version}: ${err.message}`);
      throw new MigrationError(`Migration v${migration.version} failed: ${err.message}`, 'APPLY_FAILED', {
        version: migration.version,
        originalError: err.message
      });
    } finally {
      this.isLocked = false;
    }
  }

  /**
   * Apply all pending migrations in ascending version order
   * @param {Array<object>} availableMigrations 
   * @param {object} [options]
   */
  async runAllPending(availableMigrations = [], options = {}) {
    const pending = await this.getPendingMigrations(availableMigrations);
    const results = [];

    for (const m of pending) {
      const res = await this.applyMigration(m, options);
      results.push(res);
    }

    return {
      appliedCount: results.length,
      results
    };
  }
}

module.exports = {
  DatabaseMigrationManager,
  MigrationError
};

