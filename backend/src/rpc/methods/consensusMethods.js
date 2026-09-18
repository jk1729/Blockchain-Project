/**
 * PDSChain JSON-RPC 2.0 Consensus & Validator Methods (Phase 14)
 */

const consensusService = require('../../services/consensusService');
const fbaInstance = require('../../consensus/FBAConsensus');
const { RPC_ERRORS, JsonRpcError } = require('../JsonRpcErrors');

const consensusMethods = {
  /**
   * pds_getValidators
   * params: []
   */
  async pds_getValidators(params, context) {
    const validators = fbaInstance.getValidators();
    return validators.map(v => typeof v.toJSON === 'function' ? v.toJSON() : v);
  },

  /**
   * pds_getConsensusStatus
   * params: []
   */
  async pds_getConsensusStatus(params, context) {
    const net = consensusService.getStatus();
    return {
      model: 'Federated Byzantine Agreement (FBA)',
      validatorsCount: net.totalValidators,
      onlineValidators: net.onlineCount,
      offlineValidators: net.offlineCount,
      hasQuorum: net.hasQuorum,
      quorumPercentage: net.quorumPercentage
    };
  },

  /**
   * pds_getQuorum
   * params: []
   */
  async pds_getQuorum(params, context) {
    return consensusService.getQuorumDetails();
  },

  /**
   * pds_propose
   * params: [proposalObject]
   */
  async pds_propose(params, context) {
    if (!params || !params[0]) {
      throw new JsonRpcError(RPC_ERRORS.INVALID_PARAMS, 'Expected [proposalObject]');
    }

    // Proposing requires authenticated consortium participant with appropriate role
    if (!context || !context.user || !['SHOP', 'ADMIN', 'VALIDATOR'].includes(context.user.role)) {
      throw new JsonRpcError(RPC_ERRORS.UNAUTHORIZED, 'Unauthorized: Valid proposer role required');
    }

    const proposal = params[0];
    try {
      const result = await consensusService.runConsensus(proposal);
      return result;
    } catch (err) {
      throw new JsonRpcError(RPC_ERRORS.EXECUTION_ERROR, `Consensus proposal rejected: ${err.message}`, { details: err.message });
    }
  }
};

module.exports = consensusMethods;
