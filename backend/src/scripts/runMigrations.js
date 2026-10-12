/**
 * Safe, controlled migration runner for PDSChain.
 * Applies non-destructive incremental migrations (e.g. 002_pds_receipts)
 * via DatabaseMigrationManager without invoking destructive initial syncs.
 */

const { sequelize } = require('../config/database');
const { DatabaseMigrationManager } = require('../database/DatabaseMigrationManager');
const migration002 = require('../migrations/002_pds_receipts');

async function runControlledMigrations() {
  const mgr = new DatabaseMigrationManager({ sequelize });
  await mgr.ensureMigrationTable();

  const res = await mgr.applyMigration(migration002, {
    useTransaction: true,
    appliedBy: process.env.MIGRATION_ACTOR || 'CLI_MIGRATION_RUNNER'
  });

  console.log(JSON.stringify(res, null, 2));
  await sequelize.close();
}

if (require.main === module) {
  runControlledMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err.message);
      process.exit(1);
    });
}

module.exports = { runControlledMigrations };

