/**
 * PDSChain Cryptographic Ledger Checkpoint (Phase 10)
 * 
 * Immutable record cryptographically binding a finalized block header,
 * consensus certificate, and execution commitments.
 */

const crypto = require('crypto');
const { serializeCanonical } = require('../serialization');

class LedgerCheckpoint {
  /**
   * @param {object} params
   */
  constructor(params = {}) {
    this.blockHeight = parseInt(params.blockHeight !== undefined ? params.blockHeight : 0, 10);
    this.blockHash = String(params.blockHash || '').toLowerCase().trim();
    this.previousHash = String(params.previousHash || '').toLowerCase().trim();
    this.stateRoot = String(params.stateRoot || '').toLowerCase().trim();
    this.receiptsRoot = String(params.receiptsRoot || '').toLowerCase().trim();
    this.merkleRoot = String(params.merkleRoot || '').toLowerCase().trim();
    this.certificateHash = String(params.certificateHash || '').toLowerCase().trim();
    this.signerCount = parseInt(params.signerCount !== undefined ? params.signerCount : 0, 10);
    this.signerIds = Array.isArray(params.signerIds) ? [...params.signerIds].sort() : [];
    this.journalOffset = parseInt(params.journalOffset !== undefined ? params.journalOffset : 0, 10);
    this.timestamp = params.timestamp || new Date().toISOString();
    this.verificationStatus = params.verificationStatus || 'VERIFIED';
    this.checkpointHash = params.checkpointHash || this.calculateHash();
  }

  /**
   * Compute deterministic SHA-256 hash of canonical checkpoint fields
   * @returns {string}
   */
  calculateHash() {
    const canonicalPayload = {
      blockHeight: this.blockHeight,
      blockHash: this.blockHash,
      previousHash: this.previousHash,
      stateRoot: this.stateRoot,
      receiptsRoot: this.receiptsRoot,
      merkleRoot: this.merkleRoot,
      certificateHash: this.certificateHash,
      signerCount: this.signerCount,
      signerIds: this.signerIds,
      journalOffset: this.journalOffset,
      timestamp: this.timestamp
    };
    const canonicalStr = serializeCanonical(canonicalPayload);
    return crypto.createHash('sha256').update(canonicalStr).digest('hex');
  }

  /**
   * Verify this checkpoint against a finalized Block instance and ConsensusCertificate
   * @param {Block|object} block 
   * @param {ConsensusCertificate|object} [cert]
   * @returns {{ valid: boolean, reason?: string }}
   */
  verifyAgainstBlock(block, cert = null) {
    if (!block) return { valid: false, reason: 'Block is null or undefined' };

    const blockNum = parseInt(block.blockNumber !== undefined ? block.blockNumber : block.index, 10);
    if (blockNum !== this.blockHeight) {
      return { valid: false, reason: `Height mismatch: checkpoint has #${this.blockHeight}, block is #${blockNum}` };
    }

    const bHash = String(block.blockHash || block.hash || '').toLowerCase();
    if (bHash !== this.blockHash) {
      return { valid: false, reason: `Block hash mismatch: checkpoint has '${this.blockHash}', block has '${bHash}'` };
    }

    const prevHash = String(block.previousHash || '').toLowerCase();
    if (prevHash !== this.previousHash) {
      return { valid: false, reason: `Previous hash mismatch: checkpoint has '${this.previousHash}', block has '${prevHash}'` };
    }

    if (this.stateRoot && block.stateRoot) {
      const bState = String(block.stateRoot).toLowerCase();
      if (bState !== this.stateRoot) {
        return { valid: false, reason: `State root mismatch: checkpoint has '${this.stateRoot}', block has '${bState}'` };
      }
    }

    if (this.merkleRoot && block.merkleRoot) {
      const bMerkle = String(block.merkleRoot).toLowerCase();
      if (bMerkle !== this.merkleRoot) {
        return { valid: false, reason: `Merkle root mismatch: checkpoint has '${this.merkleRoot}', block has '${bMerkle}'` };
      }
    }

    // Verify certificate commitments if present
    const certificate = cert || block.consensusCertificate;
    if (certificate && this.certificateHash) {
      const cHash = String(certificate.certificateHash || '').toLowerCase();
      if (cHash !== this.certificateHash) {
        return { valid: false, reason: `Certificate hash mismatch: checkpoint has '${this.certificateHash}', certificate has '${cHash}'` };
      }
    }

    // Verify checkpoint self-integrity
    if (this.calculateHash() !== this.checkpointHash) {
      return { valid: false, reason: 'Checkpoint self-hash validation failed; data has been tampered' };
    }

    return { valid: true };
  }

  toJSON() {
    return {
      blockHeight: this.blockHeight,
      blockHash: this.blockHash,
      previousHash: this.previousHash,
      stateRoot: this.stateRoot,
      receiptsRoot: this.receiptsRoot,
      merkleRoot: this.merkleRoot,
      certificateHash: this.certificateHash,
      signerCount: this.signerCount,
      signerIds: this.signerIds,
      journalOffset: this.journalOffset,
      timestamp: this.timestamp,
      verificationStatus: this.verificationStatus,
      checkpointHash: this.checkpointHash
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new Error('LedgerCheckpoint.fromJSON expects an object');
    }
    return new LedgerCheckpoint(json);
  }

  /**
   * Create checkpoint directly from a verified finalized block
   * @param {Block} block 
   * @param {number} [journalOffset=0] 
   * @returns {LedgerCheckpoint}
   */
  static fromFinalizedBlock(block, journalOffset = 0) {
    const cert = block.consensusCertificate || {};
    const approvals = Array.isArray(cert.validatorApprovals) ? cert.validatorApprovals : [];
    const signerIds = approvals.map(a => a.validatorId || a.id).filter(Boolean);

    return new LedgerCheckpoint({
      blockHeight: block.blockNumber,
      blockHash: block.blockHash,
      previousHash: block.previousHash,
      stateRoot: block.stateRoot,
      receiptsRoot: block.receiptsRoot || '',
      merkleRoot: block.merkleRoot,
      certificateHash: cert.certificateHash || '',
      signerCount: approvals.length,
      signerIds,
      journalOffset,
      timestamp: block.timestamp || new Date().toISOString(),
      verificationStatus: 'VERIFIED'
    });
  }
}

module.exports = LedgerCheckpoint;

