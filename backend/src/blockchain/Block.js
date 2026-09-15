const { sha256, hashBlockHeader, hashProposal } = require('./hashing');
const { calculateMerkleRoot } = require('./merkle');
const { signBlockProposal, verifyBlockProposalSignature } = require('./identity/signature');
const { getPublicParticipantInfo } = require('./identity/keyManager');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const Transaction = require('./Transaction');

class Block {
  constructor(
    blockNumber,
    timestamp,
    transactions = [],
    previousHash = '',
    nonce = 0,
    consensusStatus = 'FINALIZED',
    validatorSignatures = [],
    stateRoot = null,
    options = {}
  ) {
    this.version = parseInt(options.version !== undefined ? options.version : 1, 10);
    this.blockNumber = parseInt(blockNumber !== undefined ? blockNumber : (options.index || 0), 10);
    this.timestamp = timestamp || new Date().toISOString();
    
    // Normalize transactions into array of objects or Transaction instances
    const rawTxArray = Array.isArray(transactions) ? transactions : [transactions];
    this.transactions = rawTxArray.map(tx => {
      if (tx instanceof Transaction) return tx.toBlockPayload();
      return tx;
    });

    this.previousHash = previousHash || '';
    this.nonce = parseInt(nonce, 10) || 0;
    this.consensusStatus = consensusStatus || (options.status || 'FINALIZED');
    this.validatorSignatures = Array.isArray(validatorSignatures) ? validatorSignatures : [];
    this.merkleRoot = calculateMerkleRoot(this.transactions);
    this.stateRoot = stateRoot || options.stateRoot || null;

    // Phase 6 Proposer & Consensus Metadata
    this.proposerId = options.proposerId || (this.blockNumber === 0 ? 'GENESIS' : 'VAL-01');
    this.proposerAddress = options.proposerAddress || null;
    if (!this.proposerAddress && this.proposerId) {
      const pInfo = getPublicParticipantInfo(this.proposerId);
      if (pInfo) this.proposerAddress = pInfo.address;
    }

    this.round = parseInt(options.round !== undefined ? options.round : 0, 10);
    this.proposalId = options.proposalId || this.calculateProposalId();
    this.proposerSignature = options.proposerSignature || null;

    if (options.consensusCertificate) {
      this.consensusCertificate = options.consensusCertificate instanceof ConsensusCertificate
        ? options.consensusCertificate.toJSON()
        : options.consensusCertificate;
    } else {
      this.consensusCertificate = null;
    }

    this.blockHash = this.calculateHash();
  }

  /**
   * Extract conceptual block header payload
   */
  getHeader() {
    return {
      version: this.version,
      blockNumber: this.blockNumber,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      merkleRoot: this.merkleRoot,
      stateRoot: this.stateRoot,
      proposerId: this.proposerId,
      nonce: this.nonce,
      consensusStatus: this.consensusStatus
    };
  }

  /**
   * Extract candidate proposal header payload for signing & proposalId
   */
  getProposalHeader() {
    return {
      version: this.version,
      blockNumber: this.blockNumber,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      merkleRoot: this.merkleRoot,
      stateRoot: this.stateRoot,
      proposerId: this.proposerId,
      proposerAddress: this.proposerAddress,
      round: this.round
    };
  }

  calculateHash() {
    return hashBlockHeader(this.getHeader());
  }

  calculateProposalId() {
    return hashProposal(this.getProposalHeader());
  }

  signProposal(privateKey) {
    if (!privateKey) throw new Error('Private key is required to sign block proposal');
    this.proposalId = this.calculateProposalId();
    this.proposerSignature = signBlockProposal(this.getProposalHeader(), privateKey);
    return this.proposerSignature;
  }

  verifyProposerSignature(publicKey = null) {
    if (!this.proposerSignature) {
      return { valid: false, reason: 'MISSING_PROPOSER_SIGNATURE' };
    }
    let pubKey = publicKey;
    if (!pubKey && this.proposerId) {
      const pInfo = getPublicParticipantInfo(this.proposerId);
      if (pInfo) pubKey = pInfo.publicKey;
    }
    if (!pubKey) {
      return { valid: false, reason: 'MISSING_PROPOSER_PUBLIC_KEY' };
    }
    return verifyBlockProposalSignature(this.getProposalHeader(), this.proposerSignature, pubKey);
  }

  attachCertificate(certificate) {
    this.consensusCertificate = certificate instanceof ConsensusCertificate ? certificate.toJSON() : certificate;
    this.consensusStatus = 'FINALIZED';
    if (certificate && Array.isArray(certificate.validatorApprovals)) {
      this.validatorSignatures = certificate.validatorApprovals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      }));
    }
    this.blockHash = this.calculateHash();
  }

  mineBlock(difficulty = 2) {
    const target = Array(difficulty + 1).join('0');
    while (this.blockHash.substring(0, difficulty) !== target) {
      this.nonce++;
      this.blockHash = this.calculateHash();
    }
    return this.blockHash;
  }

  isValid() {
    if (this.blockHash !== this.calculateHash()) {
      return false;
    }
    if (this.merkleRoot !== calculateMerkleRoot(this.transactions)) {
      return false;
    }
    return true;
  }

  isFinalized() {
    return this.consensusStatus === 'FINALIZED' || this.consensusStatus === 'VERIFIED';
  }

  toJSON() {
    return {
      version: this.version,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      previousHash: this.previousHash,
      timestamp: this.timestamp,
      transactions: this.transactions,
      txCount: this.transactions.length,
      nonce: this.nonce,
      merkleRoot: this.merkleRoot,
      stateRoot: this.stateRoot,
      proposerId: this.proposerId,
      proposerAddress: this.proposerAddress,
      proposerSignature: this.proposerSignature,
      proposalId: this.proposalId,
      round: this.round,
      consensusStatus: this.consensusStatus,
      consensusCertificate: this.consensusCertificate,
      validatorSignatures: this.validatorSignatures,
      // Compatibility aliases for frontend & legacy consumers
      number: this.blockNumber,
      index: this.blockNumber,
      hash: this.blockHash,
      prevHash: this.previousHash,
      txns: this.transactions.length,
      validators: this.validatorSignatures.length || 12,
      status: this.consensusStatus
    };
  }
}

module.exports = Block;
