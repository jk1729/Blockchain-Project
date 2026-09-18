/**
 * PDSChain Merkle Proof Package Entrypoint (Phase 16)
 */

const {
  MerkleTree,
  hashTransactionLeaf,
  hashReceiptLeaf,
  hashEventLeaf,
  getMerkleTree,
  calculateMerkleRoot,
  sha256
} = require('./MerkleTree');

const MerkleProof = require('./MerkleProof');
const { MerkleError, MERKLE_ERROR_CODES } = require('./MerkleErrors');
const { verifyMerkleProof, verifyMerkleProofBatch } = require('./standaloneVerifier');
const ProofMetrics = require('./ProofMetrics');
const ProofIndexer = require('./ProofIndexer');

const CommitmentVersion = {
  V1: 1,
  V2: 2
};

const CommitmentType = {
  TRANSACTION: 'TRANSACTION',
  RECEIPT: 'RECEIPT',
  EVENT: 'EVENT'
};

module.exports = {
  MerkleTree,
  MerkleProof,
  MerkleError,
  MERKLE_ERROR_CODES,
  verifyMerkleProof,
  verifyMerkleProofBatch,
  ProofMetrics,
  ProofIndexer,
  CommitmentVersion,
  CommitmentType,
  hashTransactionLeaf,
  hashReceiptLeaf,
  hashEventLeaf,
  getMerkleTree,
  calculateMerkleRoot,
  sha256
};
