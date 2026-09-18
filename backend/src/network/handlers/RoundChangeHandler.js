const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class RoundChangeHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {Function} [params.onRoundChange] - async (roundChangeData, peerConn) => void
   */
  constructor(params = {}) {
    this.config = params.config;
    this.onRoundChange = params.onRoundChange || null;
  }

  /**
   * Handle incoming round change notification/request
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handle(envelope, peerConn) {
    const payload = envelope.payload;
    if (!payload || typeof payload !== 'object') {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Missing round change payload');
    }

    const { blockHeight, currentRound, newRound, reason } = payload;
    if (blockHeight === undefined || newRound === undefined) {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Round change missing blockHeight or newRound');
    }

    const senderId = String(envelope.senderId).toUpperCase().trim();
    if (this.config.authorizedValidators && !this.config.authorizedValidators.includes(senderId)) {
      throw new NetworkError(NetworkErrorCode.UNAUTHORIZED_PEER, `Round change from unauthorized validator '${senderId}'`);
    }

    logger.info(`[RoundChangeHandler] Round change from ${senderId} for height ${blockHeight}: round ${currentRound} -> ${newRound} (reason: ${reason || 'timeout'})`);

    if (this.onRoundChange) {
      await this.onRoundChange(payload, peerConn);
    }
  }
}

module.exports = RoundChangeHandler;

