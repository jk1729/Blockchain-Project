/**
 * PDSChain v1 Health Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const blockchainService = require('../../services/blockchainService');
const fbaInstance = require('../../consensus/FBAConsensus');
const { sendSuccess } = require('../../api/ResponseEnvelope');

// GET /api/v1/health
router.get('/', (req, res) => {
  const chainValidation = blockchainService.validateChain();
  const network = fbaInstance.getNetworkStatus();

  return sendSuccess(res, {
    service: 'PDSChain Backend API',
    status: 'HEALTHY',
    timestamp: new Date().toISOString(),
    database: 'connected',
    blockchain: {
      valid: chainValidation.isValid,
      height: chainValidation.blockCount
    },
    consensus: {
      model: 'Federated Byzantine Agreement (FBA)',
      validatorsOnline: `${network.onlineCount} / ${network.totalValidators}`,
      quorumStatus: network.hasQuorum ? 'OPERATIONAL' : 'DEGRADED'
    }
  });
});

module.exports = router;

