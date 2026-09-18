/**
 * PDSChain Merkle Proof Errors & Codes (Phase 16)
 */

const MERKLE_ERROR_CODES = {
  MALFORMED_PROOF: 'MALFORMED_PROOF',
  INVALID_LEAF: 'INVALID_LEAF',
  INVALID_SIBLING: 'INVALID_SIBLING',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  ROOT_MISMATCH: 'ROOT_MISMATCH',
  VERSION_UNSUPPORTED: 'VERSION_UNSUPPORTED',
  COMMITMENT_MISMATCH: 'COMMITMENT_MISMATCH',
  PROOF_NOT_FOUND: 'PROOF_NOT_FOUND',
  INDEX_OUT_OF_BOUNDS: 'INDEX_OUT_OF_BOUNDS',
  EMPTY_TREE: 'EMPTY_TREE',
  OVERSIZED_PAYLOAD: 'OVERSIZED_PAYLOAD',
  NODE_SYNCING: 'NODE_SYNCING',
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED'
};

class MerkleError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MerkleError';
    this.code = code || MERKLE_ERROR_CODES.MALFORMED_PROOF;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details
    };
  }
}

module.exports = {
  MERKLE_ERROR_CODES,
  MerkleError
};

