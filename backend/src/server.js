const app = require('./app');
const config = require('./config/env');
const { sequelize, testConnection } = require('./config/database');
const blockchainService = require('./services/blockchainService');
const fbaInstance = require('./consensus/FBAConsensus');
const Validator = require('./models/Validator');
const logger = require('./utils/logger');
const { autoSeedIfEmpty } = require('./seed/seedDatabase');
const { defaultHealthManager, defaultRuntimeMetrics } = require('./observability');

let server;

async function startServer() {
  try {
    // 0. Validate Environment Configuration
    config.validateConfig(process.env);

    logger.info('Initializing PDSChain backend...');

    // 1. Authenticate & Sync Database
    const { defaultDatabaseManager } = require('./database/DatabaseManager');
    await defaultDatabaseManager.init();
    await sequelize.sync({ alter: false });
    logger.info('Database synchronized successfully.');

    // 2. Auto-seed if database is freshly created
    await autoSeedIfEmpty();

    // 3. Initialize Blockchain & load blocks
    await blockchainService.init();
    await require('./services/transactionService').drainTransferEventOutbox();

    // 4. Load Validators from DB into FBA Consensus Engine
    const validatorRecords = await Validator.findAll({ order: [['id', 'ASC']] });
    fbaInstance.loadValidatorsFromDB(validatorRecords);

    // 5. Start listening & initialize observability
    server = app.listen(config.PORT, () => {
      defaultHealthManager.setStarted(true);
      defaultRuntimeMetrics.startSampling(5000);

      logger.info(`==========================================================`);
      logger.info(` PDSChain Backend Server Running at http://localhost:${config.PORT}`);
      logger.info(` Environment: ${config.NODE_ENV}`);
      logger.info(` Consensus Engine: 12-Validator Federated Byzantine Agreement`);
      logger.info(` Blockchain Height: #${blockchainService.blockchain.chain.length}`);
      logger.info(` Health Check: http://localhost:${config.PORT}/health`);
      logger.info(` Metrics Endpoint: http://localhost:${config.PORT}/metrics`);
      logger.info(`==========================================================`);
    });

    return server;
  } catch (err) {
    logger.error('Fatal Server Initialization Error:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer
};
