const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class ProposalHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {Function} [params.onProposal] - async (proposalPayload, peerConn) => void
   */
  constructor(params = {}) {
    this.config = params.config;
    this.onProposal = params.onProposal || null;
  }

  /**
   * Handle incoming block proposal from a validator peer
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handle(envelope, peerConn) {
    const payload = envelope.payload;
    if (!payload || typeof payload !== 'object') {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Missing proposal payload');
    }

    const { blockHeight, round, candidateBlock } = payload;
    if (blockHeight === undefined || round === undefined || !candidateBlock) {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Proposal missing blockHeight, round, or candidateBlock');
    }

    // Verify proposer is an authorized validator
    const proposerId = String(candidateBlock.proposerId || envelope.senderId).toUpperCase().trim();
    if (this.config.authorizedValidators && !this.config.authorizedValidators.includes(proposerId)) {
      throw new NetworkError(NetworkErrorCode.UNAUTHORIZED_PEER, `Proposal from unauthorized validator '${proposerId}'`);
    }

    logger.debug(`[ProposalHandler] Received proposal for height ${blockHeight}, round ${round} from ${proposerId}`);

    if (this.onProposal) {
      await this.onProposal(payload, peerConn);
    }
  }
}

module.exports = ProposalHandler;

