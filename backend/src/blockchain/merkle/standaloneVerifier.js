/**
 * PDSChain Standalone Merkle Proof Verifier (Phase 16)
 * 
 * Verifies cryptographic inclusion proofs using ONLY:
 * - Proof envelope data
 * - Optional leaf data or hash
 * - Optional expected root
 * 
 * Requires zero database, network, or validator node access.
 */

const crypto = require('crypto');
const MerkleProof = require('./MerkleProof');
const { MERKLE_ERROR_CODES } = require('./MerkleErrors');

/**
 * Pure verification function.
 * @param {object|MerkleProof} proof - MerkleProof instance or plain proof JSON
 * @param {string|object} [leafDataOrHash] - Optional leaf string or hash
 * @param {string} [expectedRoot] - Optional root override
 * @returns {{ valid: boolean, reason?: string, message: string, computedRoot: string, expectedRoot: string, leafIndex: number, treeDepth: number }}
 */
function verifyMerkleProof(proof, leafDataOrHash = null, expectedRoot = null) {
  if (!proof || typeof proof !== 'object') {
    return {
      valid: false,
      reason: MERKLE_ERROR_CODES.MALFORMED_PROOF,
      message: 'Proof must be a valid non-null object',
      computedRoot: null,
      expectedRoot: null,
      leafIndex: -1,
      treeDepth: -1
    };
  }

  let proofInstance;
  if (proof instanceof MerkleProof) {
    proofInstance = proof;
  } else {
    try {
      proofInstance = MerkleProof.fromJSON(proof);
    } catch (err) {
      return {
        valid: false,
        reason: err.code || MERKLE_ERROR_CODES.MALFORMED_PROOF,
        message: err.message,
        computedRoot: null,
        expectedRoot: proof.expectedRoot || null,
        leafIndex: proof.leafIndex !== undefined ? proof.leafIndex : -1,
        treeDepth: proof.treeDepth !== undefined ? proof.treeDepth : -1
      };
    }
  }

  return proofInstance.verify(leafDataOrHash, expectedRoot);
}

/**
 * Batch verification function.
 * @param {Array<object>} proofRequests - Array of { proof, leaf, expectedRoot }
 * @param {number} [maxBatch=50]
 * @returns {Array<object>}
 */
function verifyMerkleProofBatch(proofRequests, maxBatch = 50) {
  if (!Array.isArray(proofRequests)) {
    throw new Error('Batch verification input must be an array');
  }
  if (proofRequests.length > maxBatch) {
    throw new Error(`Batch verification exceeds maximum allowed batch size of ${maxBatch}`);
  }

  return proofRequests.map(req => {
    return verifyMerkleProof(req.proof, req.leaf, req.expectedRoot);
  });
}

module.exports = {
  verifyMerkleProof,
  verifyMerkleProofBatch
};

