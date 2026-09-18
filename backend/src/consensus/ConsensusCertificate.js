const crypto = require('crypto');
const { serializeCanonical, hashCanonical } = require('../blockchain/serialization');
const { verifyValidatorVoteSignature, extractUnsignedVotePayload } = require('../blockchain/identity/signature');
const { getPublicParticipantInfo } = require('../blockchain/identity/keyManager');
const { findQuorum } = require('./Quorum');

class ConsensusCertificate {
  constructor(data = {}) {
    this.version = parseInt(data.version, 10) || 1;
    this.proposalId = String(data.proposalId || '');
    this.blockNumber = parseInt(data.blockNumber !== undefined ? data.blockNumber : data.blockIndex, 10) || 0;
    this.blockHash = String(data.blockHash || '');
    this.stateRoot = String(data.stateRoot || '');
    this.round = parseInt(data.round, 10) || 0;
    this.threshold = parseInt(data.threshold, 10) || 9;
    this.totalValidators = parseInt(data.totalValidators, 10) || 12;
    this.achieved = data.achieved !== undefined ? Boolean(data.achieved) : false;
    this.chainId = data.chainId !== undefined && data.chainId !== null && data.chainId !== '' ? parseInt(data.chainId, 10) : undefined;

    // Deterministically sort validator approvals by validatorId ASC
    const rawApprovals = Array.isArray(data.validatorApprovals) ? data.validatorApprovals : [];
    this.validatorApprovals = rawApprovals
      .map(app => ({
        validatorId: String(app.validatorId || ''),
        validatorAddress: String(app.validatorAddress || ''),
        validatorPublicKey: String(app.validatorPublicKey || '').replace(/^0x/, ''),
        signature: String(app.signature || ''),
        timestamp: String(app.timestamp || ''),
        vote: String(app.vote || 'ACCEPT').toUpperCase()
      }))
      .sort((a, b) => a.validatorId.localeCompare(b.validatorId));

    this.certificateHash = data.certificateHash || this.calculateHash();
  }

  /**
   * Canonically hash certificate content to produce deterministic certificateHash
   * @returns {string} 64-character lowercase SHA-256 hex string
   */
  calculateHash() {
    const payload = {
      domain: 'PDSCHAIN_CERTIFICATE_V1',
      version: this.version,
      proposalId: this.proposalId,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      stateRoot: this.stateRoot,
      round: this.round,
      threshold: this.threshold,
      totalValidators: this.totalValidators,
      achieved: this.achieved,
      validatorApprovals: this.validatorApprovals
    };
    if (this.chainId !== undefined) payload.chainId = this.chainId;

    return hashCanonical(payload);
  }

  toJSON() {
    const data = {
      version: this.version,
      proposalId: this.proposalId,
      blockNumber: this.blockNumber,
      blockHash: this.blockHash,
      stateRoot: this.stateRoot,
      round: this.round,
      threshold: this.threshold,
      totalValidators: this.totalValidators,
      achieved: this.achieved,
      validatorApprovals: this.validatorApprovals,
      approvalCount: this.validatorApprovals.length,
      certificateHash: this.certificateHash
    };
    if (this.chainId !== undefined) data.chainId = this.chainId;
    return data;
  }

  static fromJSON(data) {
    return new ConsensusCertificate(data);
  }

  /**
   * Standalone, independent verification of a consensus certificate against a block
   * @param {ConsensusCertificate|object} certificate 
   * @param {Block|object} block 
   * @param {Map<string, ValidatorNode>|Array<ValidatorNode>} [validatorRegistry] 
   * @returns {{ valid: boolean, code?: string, reason?: string }}
   */
  static verify(certificate, block, validatorRegistry = null) {
    if (!certificate) {
      return { valid: false, code: 'MISSING_CERTIFICATE', reason: 'Consensus certificate is missing or null' };
    }
    if (!block) {
      return { valid: false, code: 'MISSING_BLOCK', reason: 'Block is missing or null' };
    }

    const cert = certificate instanceof ConsensusCertificate ? certificate : new ConsensusCertificate(certificate);

    // 1. Verify certificate hash self-consistency
    const expectedCertHash = cert.calculateHash();
    if (cert.certificateHash !== expectedCertHash) {
      return {
        valid: false,
        code: 'CERTIFICATE_HASH_MISMATCH',
        reason: `Certificate hash mismatch: expected '${expectedCertHash}', found '${cert.certificateHash}'`
      };
    }

    // 2. Verify binding to blockHash
    const blockHash = String(block.blockHash || block.hash || '');
    if (cert.blockHash !== blockHash) {
      return {
        valid: false,
        code: 'BLOCK_HASH_MISMATCH',
        reason: `Certificate blockHash '${cert.blockHash}' does not match block hash '${blockHash}'`
      };
    }

    // 3. Verify binding to proposalId if present on block
    if (block.proposalId && cert.proposalId !== block.proposalId) {
      return {
        valid: false,
        code: 'PROPOSAL_ID_MISMATCH',
        reason: `Certificate proposalId '${cert.proposalId}' does not match block proposalId '${block.proposalId}'`
      };
    }

    // 4. Verify binding to stateRoot
    const blockStateRoot = String(block.stateRoot || '');
    if (blockStateRoot && cert.stateRoot !== blockStateRoot) {
      return {
        valid: false,
        code: 'STATE_ROOT_MISMATCH',
        reason: `Certificate stateRoot '${cert.stateRoot}' does not match block stateRoot '${blockStateRoot}'`
      };
    }

    // 5. Verify binding to blockNumber
    const blockNumber = parseInt(block.blockNumber !== undefined ? block.blockNumber : block.index, 10);
    if (cert.blockNumber !== blockNumber) {
      return {
        valid: false,
        code: 'BLOCK_NUMBER_MISMATCH',
        reason: `Certificate blockNumber #${cert.blockNumber} does not match block #${blockNumber}`
      };
    }

    // 6. Verify binding to round if set
    if (block.round !== undefined && cert.round !== block.round) {
      return {
        valid: false,
        code: 'ROUND_MISMATCH',
        reason: `Certificate round ${cert.round} does not match block round ${block.round}`
      };
    }

    // 7. Verify validator approvals count and threshold
    if (!cert.achieved) {
      return { valid: false, code: 'QUORUM_NOT_ACHIEVED', reason: 'Consensus certificate indicates quorum was not achieved' };
    }

    if (cert.validatorApprovals.length < cert.threshold) {
      return {
        valid: false,
        code: 'INSUFFICIENT_APPROVALS',
        reason: `Certificate contains ${cert.validatorApprovals.length} approvals, required threshold is ${cert.threshold}`
      };
    }

    // 8. Verify each validator approval
    const seenValidators = new Set();
    const agreeingValidatorIds = [];

    for (const approval of cert.validatorApprovals) {
      if (approval.vote !== 'ACCEPT') {
        return {
          valid: false,
          code: 'INVALID_APPROVAL_VOTE',
          reason: `Validator ${approval.validatorId} approval has non-ACCEPT vote: '${approval.vote}'`
        };
      }

      if (seenValidators.has(approval.validatorId)) {
        return {
          valid: false,
          code: 'DUPLICATE_VALIDATOR_APPROVAL',
          reason: `Duplicate validator approval in certificate: ${approval.validatorId}`
        };
      }
      seenValidators.add(approval.validatorId);
      agreeingValidatorIds.push(approval.validatorId);

      // Verify validator public key
      let pubKey = approval.validatorPublicKey;
      if (!pubKey) {
        const info = getPublicParticipantInfo(approval.validatorId);
        if (info) pubKey = info.publicKey;
      }

      if (!pubKey) {
        return {
          valid: false,
          code: 'UNKNOWN_VALIDATOR',
          reason: `Unknown validator ID '${approval.validatorId}' in certificate approvals`
        };
      }

      // Verify cryptographic vote signature
      const votePayload = {
        validatorId: approval.validatorId,
        validatorAddress: approval.validatorAddress,
        validatorPublicKey: pubKey,
        proposalId: cert.proposalId,
        blockNumber: cert.blockNumber,
        blockHash: cert.blockHash,
        stateRoot: cert.stateRoot,
        round: cert.round,
        vote: 'ACCEPT',
        reason: ''
      };
      if (cert.chainId !== undefined) {
        votePayload.chainId = cert.chainId;
      }

      const sigCheck = verifyValidatorVoteSignature(votePayload, approval.signature, pubKey);
      if (!sigCheck.valid) {
        return {
          valid: false,
          code: 'INVALID_VALIDATOR_SIGNATURE',
          reason: `Cryptographic vote signature check failed for validator ${approval.validatorId}: ${sigCheck.reason}`
        };
      }
    }

    // 9. If validatorRegistry provided, evaluate FBA quorum slices
    if (validatorRegistry) {
      const vMap = validatorRegistry instanceof Map
        ? validatorRegistry
        : new Map(validatorRegistry.map(v => [v.validatorId, v]));

      const quorumRes = findQuorum(agreeingValidatorIds, vMap);
      if (!quorumRes.isQuorum || quorumRes.quorumSize < cert.threshold) {
        return {
          valid: false,
          code: 'QUORUM_SLICE_FAILURE',
          reason: `FBA Quorum slices could not be satisfied for agreeing set (${agreeingValidatorIds.length} nodes)`
        };
      }
    }

    return {
      valid: true,
      approvalCount: cert.validatorApprovals.length,
      threshold: cert.threshold,
      certificateHash: cert.certificateHash
    };
  }
}

module.exports = ConsensusCertificate;

