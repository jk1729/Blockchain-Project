const ValidatorVote = require('../../consensus/ValidatorVote');
const { NetworkErrorCode, NetworkError } = require('../NetworkErrors');
const logger = require('../../utils/logger');

class VoteHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {VoteStore} [params.voteStore]
   * @param {Function} [params.onVote] - async (vote, peerConn) => void
   */
  constructor(params = {}) {
    this.config = params.config;
    this.voteStore = params.voteStore || null;
    this.onVote = params.onVote || null;
  }

  /**
   * Handle incoming validator vote
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handle(envelope, peerConn) {
    const payload = envelope.payload;
    if (!payload || typeof payload !== 'object') {
      throw new NetworkError(NetworkErrorCode.INVALID_PAYLOAD, 'Missing vote payload');
    }

    const voteData = payload.vote || payload;
    const vote = voteData instanceof ValidatorVote ? voteData : new ValidatorVote(voteData);

    // 1. Verify sender identity matches vote validatorId (prevent impersonation)
    const claimedValidator = String(vote.validatorId).toUpperCase().trim();
    const envelopeSender = String(envelope.senderId).toUpperCase().trim();
    if (claimedValidator !== envelopeSender) {
      throw new NetworkError(
        NetworkErrorCode.IDENTITY_MISMATCH,
        `Sender '${envelopeSender}' impersonating vote from '${claimedValidator}'`
      );
    }

    // 2. Cryptographic signature check
    const sigCheck = vote.verifySignature();
    if (!sigCheck.valid) {
      throw new NetworkError(
        NetworkErrorCode.MESSAGE_TAMPERED,
        `Invalid vote signature from ${claimedValidator}: ${sigCheck.reason}`
      );
    }

    // 3. Record in voteStore if available
    let recordResult = null;
    if (this.voteStore) {
      recordResult = this.voteStore.recordVote(vote);
      if (!recordResult.success) {
        logger.warn(`[VoteHandler] Vote rejected by VoteStore: ${recordResult.reason}`);
      }
    }

    // 4. Callback to consumer
    if (this.onVote) {
      await this.onVote(vote, peerConn, recordResult);
    }

    return recordResult;
  }
}

module.exports = VoteHandler;

