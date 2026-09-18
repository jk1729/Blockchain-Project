/**
 * Consensus & Quorum Error Codes and Definitions
 */

const QuorumErrorCode = {
  INSUFFICIENT_NODES: 'INSUFFICIENT_NODES',
  SLICE_NOT_SATISFIED: 'SLICE_NOT_SATISFIED',
  CONFLICTING_PROPOSALS: 'CONFLICTING_PROPOSALS',
  UNKNOWN_VALIDATOR: 'UNKNOWN_VALIDATOR',
  OFFLINE_VALIDATOR: 'OFFLINE_VALIDATOR',
  INVALID_THRESHOLD: 'INVALID_THRESHOLD',
  QUORUM_INTERSECTION_FAILURE: 'QUORUM_INTERSECTION_FAILURE',
  DOUBLE_VOTE_DETECTED: 'DOUBLE_VOTE_DETECTED'
};

class QuorumError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'QuorumError';
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  QuorumErrorCode,
  QuorumError
};

