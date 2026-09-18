/**
 * PDSChain Database Configuration (Phase 18)
 * 
 * Re-exports unified Sequelize instance and connection test helper from
 * the Phase 18 Production DatabaseManager.
 */

const { defaultDatabaseManager } = require('../database/DatabaseManager');

module.exports = {
  sequelize: defaultDatabaseManager.sequelize,
  testConnection: () => defaultDatabaseManager.testConnection(),
  databaseManager: defaultDatabaseManager
};
