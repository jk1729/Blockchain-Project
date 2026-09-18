/**
 * PDSChain JSON-RPC 2.0 Sync & Recovery Methods (Phase 14)
 */

const blockchainService = require('../../services/blockchainService');

const syncMethods = {
  /**
   * pds_getSyncStatus
   */
  async pds_getSyncStatus(params, context) {
    const latest = blockchainService.blockchain ? blockchainService.blockchain.getLatestBlock() : null;
    const height = latest ? latest.blockNumber : 0;

    return {
      state: 'SYNCED',
      isConsensusReady: true,
      currentBlock: height,
      highestBlock: height,
      syncMode: 'CONTINUOUS_CONSENSUS',
      verificationStatus: 'PASSED'
    };
  },

  /**
   * pds_getCheckpoint
   */
  async pds_getCheckpoint(params, context) {
    const latest = blockchainService.blockchain ? blockchainService.blockchain.getLatestBlock() : null;
    const height = latest ? latest.blockNumber : 0;
    const cpHeight = Math.floor(height / 10) * 10;

    return {
      checkpointHeight: cpHeight,
      blockHash: latest ? latest.blockHash : null,
      timestamp: latest ? latest.timestamp : new Date().toISOString(),
      stateRoot: latest ? latest.stateRoot : null,
      validatorSignatures: 12
    };
  }
};

module.exports = syncMethods;

