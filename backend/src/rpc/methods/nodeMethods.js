/**
 * PDSChain JSON-RPC 2.0 Node & Health Methods (Phase 14)
 */

const blockchainService = require('../../services/blockchainService');
const fbaInstance = require('../../consensus/FBAConsensus');

const nodeMethods = {
  /**
   * pds_nodeInfo
   */
  async pds_nodeInfo(params, context) {
    const latest = blockchainService.blockchain ? blockchainService.blockchain.getLatestBlock() : null;
    return {
      clientVersion: 'PDSChain/v1.0.0/node',
      protocolVersion: 1,
      networkId: process.env.NETWORK_ID || 'pdschain-mainnet',
      chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
      currentBlockHeight: latest ? latest.blockNumber : 0,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  },

  /**
   * pds_health
   */
  async pds_health(params, context) {
    const chainValidation = blockchainService.validateChain();
    const network = fbaInstance.getNetworkStatus();

    return {
      status: 'HEALTHY',
      blockchain: {
        valid: chainValidation.isValid,
        height: chainValidation.blockCount
      },
      consensus: {
        onlineValidators: network.onlineCount,
        totalValidators: network.totalValidators,
        quorumStatus: network.hasQuorum ? 'OPERATIONAL' : 'DEGRADED'
      }
    };
  },

  /**
   * pds_metrics
   */
  async pds_metrics(params, context) {
    const metrics = (context && context.metrics) ? context.metrics.getSnapshot() : {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage(),
      activeConnections: 12
    };
    return metrics;
  }
};

module.exports = nodeMethods;

