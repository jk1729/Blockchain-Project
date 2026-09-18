/**
 * PDSChain Production Database Subsystem (Phase 18)
 */

const { DatabaseManager, defaultDatabaseManager } = require('./DatabaseManager');
const { DatabasePool, DatabasePoolError } = require('./DatabasePool');
const { DatabaseIntegrityManager, DatabaseIntegrityError } = require('./DatabaseIntegrityManager');
const { DatabaseTransactionManager, DatabaseTransactionError } = require('./DatabaseTransactionManager');
const { DatabaseMigrationManager, MigrationError } = require('./DatabaseMigrationManager');
const { DatabaseBackupManager, DatabaseBackupError } = require('./DatabaseBackupManager');
const { DatabaseMetrics, defaultDatabaseMetrics } = require('./DatabaseMetrics');
const { JournalStorageManager } = require('./JournalStorageManager');
const { DatabaseHAManager, HAError } = require('./DatabaseHAManager');

module.exports = {
  DatabaseManager,
  defaultDatabaseManager,
  DatabasePool,
  DatabasePoolError,
  DatabaseIntegrityManager,
  DatabaseIntegrityError,
  DatabaseTransactionManager,
  DatabaseTransactionError,
  DatabaseMigrationManager,
  MigrationError,
  DatabaseBackupManager,
  DatabaseBackupError,
  DatabaseMetrics,
  defaultDatabaseMetrics,
  JournalStorageManager,
  DatabaseHAManager,
  HAError
};
