const app = require('./app');
const config = require('./config/env');
const { sequelize } = require('./config/database');
const blockchainService = require('./services/blockchainService');
const fbaInstance = require('./consensus/FBAConsensus');
const Validator = require('./models/Validator');
const logger = require('./utils/logger');
const { autoSeedIfEmpty } = require('./seed/seedDatabase');
const { defaultHealthManager, defaultRuntimeMetrics } = require('./observability');
const { startAllValidators, stopAllValidators } = require('./validators/startValidators');

let server;

async function startServer() {
  try {
    // 0. Validate Environment Configuration
    config.validateConfig(process.env);

    logger.info('Initializing PDSChain backend...');

    // 1. Authenticate & Sync Database
    const { defaultDatabaseManager } = require('./database/DatabaseManager');
    await defaultDatabaseManager.init();
    await defaultDatabaseManager.syncSafe({ alter: false });
    logger.info('Database synchronized successfully.');

    // 2. Auto-seed if database is freshly created
    await autoSeedIfEmpty();

    // 3. Initialize Blockchain & load blocks
    await blockchainService.init();
    await require('./services/transactionService').drainTransferEventOutbox();

    // 4. Load Validators from DB into FBA Consensus Engine & Hydrate Telemetry Rounds
    const validatorRecords = await Validator.findAll({ order: [['id', 'ASC']] });
    fbaInstance.loadValidatorsFromDB(validatorRecords);
    fbaInstance.hydrateRoundsFromChain(blockchainService.blockchain.chain);

    // 5. Launch 12 isolated validator OS child processes (ports 4001..4012) unless disabled
    if (process.env.NODE_ENV !== 'test' && process.env.START_VALIDATOR_PROCESSES !== 'false') {
      await startAllValidators({ useChildProcesses: true });
    }

    // 6. Start listening & initialize observability
    server = app.listen(config.PORT, () => {
      defaultHealthManager.setStarted(true);
      defaultRuntimeMetrics.startSampling(5000);

      logger.info(`==========================================================`);
      logger.info(` PDSChain Backend Server Running at http://localhost:${config.PORT}`);
      logger.info(` Environment: ${config.NODE_ENV}`);
      logger.info(` Consensus Engine: 12-Validator Federated Byzantine Agreement`);
      logger.info(` Validator Processes: 12 Isolated Nodes (Ports 4001-4012)`);
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

async function shutdownServer(signal = 'SIGTERM') {
  logger.info(`[Server] Received ${signal}. Initiating graceful shutdown...`);
  try {
    defaultHealthManager.setStarted(false);
    if (typeof defaultRuntimeMetrics.stopSampling === 'function') {
      defaultRuntimeMetrics.stopSampling();
    }
    await stopAllValidators();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      logger.info('[Server] HTTP server closed.');
    }
    if (sequelize) {
      await sequelize.close();
      logger.info('[Server] Database connection closed.');
    }
  } catch (err) {
    logger.error('[Server] Error during graceful shutdown:', err);
  }
}

if (require.main === module) {
  startServer();
  process.on('SIGINT', () => shutdownServer('SIGINT').then(() => process.exit(0)));
  process.on('SIGTERM', () => shutdownServer('SIGTERM').then(() => process.exit(0)));
}

module.exports = {
  app,
  startServer,
  shutdownServer
};


