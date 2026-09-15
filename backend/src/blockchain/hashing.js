const crypto = require('crypto');
const { calculateMerkleRoot, hashTransactionLeaf, getMerkleTree } = require('./merkle');
const { serializeCanonical, hashCanonical } = require('./serialization');

/**
 * Compute SHA-256 hash of string or JSON-serializable object
 * @param {string|object} data 
 * @returns {string} SHA-256 hex digest
 */
function sha256(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Deterministically hash a transaction
 * @param {object|Transaction} tx
 * @returns {string} SHA-256 hex digest
 */
function hashTransaction(tx) {
  return hashTransactionLeaf(tx);
}

/**
 * Hash block header fields including version, Merkle root, State root, and Proposer
 */
function hashBlockHeader(header) {
  if (!header) return sha256('');
  const version = header.version !== undefined ? header.version : 1;
  const blockNumber = header.blockNumber !== undefined ? header.blockNumber : (header.index !== undefined ? header.index : 0);
  const previousHash = header.previousHash || '';
  const timestamp = header.timestamp || '';
  const merkleRoot = header.merkleRoot || '';
  const stateRoot = header.stateRoot || '';
  const proposerId = header.proposerId || '';
  const nonce = header.nonce !== undefined ? header.nonce : 0;

  // Deterministic canonical serialization of block header (commits to all critical header fields)
  const headerPayload = {
    version: parseInt(version, 10),
    blockNumber: parseInt(blockNumber, 10),
    previousHash: String(previousHash),
    timestamp: String(timestamp),
    merkleRoot: String(merkleRoot),
    stateRoot: String(stateRoot),
    proposerId: String(proposerId),
    nonce: parseInt(nonce, 10)
  };

  const canonicalStr = serializeCanonical(headerPayload);
  return crypto.createHash('sha256').update(canonicalStr).digest('hex');
}

/**
 * Hash a candidate block proposal header to derive a deterministic proposalId
 * @param {object} proposalHeader 
 * @returns {string} 64-character lowercase SHA-256 hex string
 */
function hashProposal(proposalHeader) {
  if (!proposalHeader) return sha256('');
  const version = parseInt(proposalHeader.version, 10) || 1;
  const blockNumber = parseInt(proposalHeader.blockNumber !== undefined ? proposalHeader.blockNumber : proposalHeader.index, 10) || 0;
  const previousHash = String(proposalHeader.previousHash || '');
  const timestamp = String(proposalHeader.timestamp || '');
  const merkleRoot = String(proposalHeader.merkleRoot || '');
  const stateRoot = String(proposalHeader.stateRoot || '');
  const proposerId = String(proposalHeader.proposerId || 'VAL-01');
  const proposerAddress = String(proposalHeader.proposerAddress || '');
  const round = parseInt(proposalHeader.round, 10) || 0;

  const payload = {
    domain: 'PDSCHAIN_PROPOSAL_V1',
    version,
    blockNumber,
    previousHash,
    timestamp,
    merkleRoot,
    stateRoot,
    proposerId,
    proposerAddress,
    round
  };

  return hashCanonical(payload);
}

module.exports = {
  sha256,
  calculateMerkleRoot,
  hashTransaction,
  hashBlockHeader,
  hashProposal,
  getMerkleTree
};
