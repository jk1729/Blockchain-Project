/**
 * PDSChain v1 API Router Aggregator (Phase 14)
 */

const express = require('express');
const router = express.Router();

const blockchainRoutes = require('./blockchainRoutes');
const transactionRoutes = require('./transactionRoutes');
const contractRoutes = require('./contractRoutes');
const consensusRoutes = require('./consensusRoutes');
const networkRoutes = require('./networkRoutes');
const ledgerRoutes = require('./ledgerRoutes');
const eventRoutes = require('./eventRoutes');
const healthRoutes = require('./healthRoutes');
const registryRoutes = require('./registryRoutes');
const docsRoutes = require('./docsRoutes');
const explorerRoutes = require('./explorerRoutes');
const proofRoutes = require('./proofRoutes');
const securityRoutes = require('./securityRoutes');
const databaseRoutes = require('./databaseRoutes');
const observabilityRoutes = require('./observabilityRoutes');
const simulationRoutes = require('./simulationRoutes');
const performanceRoutes = require('./performanceRoutes');
const { rpcMiddleware } = require('../../rpc');

// Mount JSON-RPC endpoint under /api/v1/rpc (supports 405 on non-POST)
router.all('/rpc', rpcMiddleware);

// Mount Sub-routers
router.use('/blockchain', blockchainRoutes);
router.use('/transactions', transactionRoutes);
router.use('/contracts', contractRoutes);
router.use('/consensus', consensusRoutes);
router.use('/network', networkRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/events', eventRoutes);
router.use('/health', healthRoutes);
router.use('/docs', docsRoutes);
router.use('/explorer', explorerRoutes);
router.use('/proofs', proofRoutes);
router.use('/security', securityRoutes);
router.use('/database', databaseRoutes);
router.use('/observability', observabilityRoutes);
router.use('/simulations', simulationRoutes);
router.use('/performance', performanceRoutes);
router.use('/', registryRoutes);

module.exports = router;
