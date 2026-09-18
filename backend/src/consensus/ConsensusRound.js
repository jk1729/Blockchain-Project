const crypto = require('crypto');
const { serializeCanonical, hashCanonical } = require('../blockchain/serialization');

class ConsensusRound {
  /**
   * @param {object} params
   * @param {number} [params.chainId=1729]
   * @param {number} params.blockHeight
   * @param {number} [params.roundNumber=0]
   * @param {string} [params.previousBlockHash='']
   * @param {string} [params.candidateBlockHash='']
   * @param {string} [params.proposerId='VAL-01']
   */
  constructor(params = {}) {
    this.chainId = parseInt(params.chainId !== undefined ? params.chainId : 1729, 10);
    this.blockHeight = parseInt(params.blockHeight !== undefined ? params.blockHeight : params.blockNumber, 10) || 0;
    this.roundNumber = parseInt(params.roundNumber !== undefined ? params.roundNumber : params.round, 10) || 0;
    this.previousBlockHash = String(params.previousBlockHash || '');
    this.candidateBlockHash = String(params.candidateBlockHash || params.blockHash || '');
    this.proposerId = String(params.proposerId || 'VAL-01');
    this.startTime = params.startTime || Date.now();
    this.timeoutMs = parseInt(params.timeoutMs, 10) || 5000;

    this.roundId = params.roundId || this.calculateRoundId();
    this.proposal = params.proposal || null;
    this.votes = new Map(); // validatorId -> ValidatorVote
    this.certificate = params.certificate || null;
    this.status = params.status || 'PENDING'; // PENDING, ACHIEVED, FAILED, TIMED_OUT
  }

  /**
   * Deterministically calculate canonical round ID
   * @returns {string} Deterministic SHA-256 hash
   */
  calculateRoundId() {
    const payload = {
      domain: 'PDSCHAIN_CONSENSUS_ROUND_V1',
      chainId: this.chainId,
      blockHeight: this.blockHeight,
      roundNumber: this.roundNumber,
      previousBlockHash: this.previousBlockHash,
      candidateBlockHash: this.candidateBlockHash
    };
    return hashCanonical(payload);
  }

  getCanonicalPayload() {
    return {
      domain: 'PDSCHAIN_CONSENSUS_ROUND_V1',
      chainId: this.chainId,
      blockHeight: this.blockHeight,
      roundNumber: this.roundNumber,
      previousBlockHash: this.previousBlockHash,
      candidateBlockHash: this.candidateBlockHash
    };
  }

  isExpired(now = Date.now()) {
    return (now - this.startTime) > this.timeoutMs;
  }

  addVote(vote) {
    if (!vote || !vote.validatorId) return false;
    this.votes.set(vote.validatorId, vote);
    return true;
  }

  getVotes() {
    return Array.from(this.votes.values());
  }

  getVote(validatorId) {
    return this.votes.get(validatorId) || null;
  }

  /**
   * Create next round for same block height on timeout or failure
   * @param {object} [nextParams]
   * @returns {ConsensusRound}
   */
  nextRound(nextParams = {}) {
    return new ConsensusRound({
      chainId: this.chainId,
      blockHeight: this.blockHeight,
      roundNumber: this.roundNumber + 1,
      previousBlockHash: this.previousBlockHash,
      candidateBlockHash: nextParams.candidateBlockHash || this.candidateBlockHash,
      proposerId: nextParams.proposerId || this.proposerId,
      timeoutMs: this.timeoutMs,
      ...nextParams
    });
  }

  toJSON() {
    return {
      roundId: this.roundId,
      chainId: this.chainId,
      blockHeight: this.blockHeight,
      roundNumber: this.roundNumber,
      previousBlockHash: this.previousBlockHash,
      candidateBlockHash: this.candidateBlockHash,
      proposerId: this.proposerId,
      startTime: this.startTime,
      timeoutMs: this.timeoutMs,
      status: this.status,
      voteCount: this.votes.size,
      hasCertificate: Boolean(this.certificate)
    };
  }
}

module.exports = ConsensusRound;

