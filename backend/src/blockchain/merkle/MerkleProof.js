/**
 * PDSChain Merkle Proof Class (Phase 16)
 * 
 * Represents an immutable, standalone verifiable Merkle inclusion proof.
 */

const crypto = require('crypto');
const { MERKLE_ERROR_CODES, MerkleError } = require('./MerkleErrors');

const HEX_64_REGEX = /^(0x)?[0-9a-fA-F]{64}$/;
const MAX_ALLOWED_DEPTH = 32;

function cleanHex(h) {
  if (typeof h !== 'string') return '';
  return h.startsWith('0x') ? h.slice(2).toLowerCase() : h.toLowerCase();
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

class MerkleProof {
  constructor({
    version = 1,
    commitmentType = 'TRANSACTION',
    hashAlgorithm = 'SHA-256',
    leafHash,
    leafIndex = 0,
    totalLeaves = 1,
    treeDepth = 0,
    siblings = [],
    expectedRoot,
    blockHeight = null,
    blockHash = null,
    transactionHash = null,
    eventId = null,
    finality = 'FINALIZED',
    timestamp = null,
    requestId = null
  } = {}) {
    this.version = Number(version) || 1;
    this.commitmentType = String(commitmentType || 'TRANSACTION').toUpperCase();
    this.hashAlgorithm = String(hashAlgorithm || 'SHA-256').toUpperCase();
    this.leafHash = cleanHex(leafHash);
    this.leafIndex = Number(leafIndex);
    this.totalLeaves = Number(totalLeaves);
    this.treeDepth = Number(treeDepth !== undefined ? treeDepth : siblings.length);
    this.siblings = Array.isArray(siblings) ? siblings.map(s => ({
      position: s ? s.position : null,
      hash: cleanHex(s ? s.hash : '')
    })) : [];
    this.expectedRoot = cleanHex(expectedRoot);
    this.blockHeight = blockHeight !== null && blockHeight !== undefined ? Number(blockHeight) : null;
    this.blockHash = blockHash ? cleanHex(blockHash) : null;
    this.transactionHash = transactionHash || null;
    this.eventId = eventId || null;
    this.finality = String(finality || 'FINALIZED').toUpperCase();
    this.timestamp = timestamp || new Date().toISOString();
    this.requestId = requestId || `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Validate proof structure and bounds before verification
   */
  validateStructure() {
    if (this.version !== 1 && this.version !== 2) {
      throw new MerkleError(MERKLE_ERROR_CODES.VERSION_UNSUPPORTED, `Unsupported Merkle version: ${this.version}`);
    }

    if (!['TRANSACTION', 'RECEIPT', 'EVENT'].includes(this.commitmentType)) {
      throw new MerkleError(MERKLE_ERROR_CODES.COMMITMENT_MISMATCH, `Unsupported commitment type: ${this.commitmentType}`);
    }

    if (!HEX_64_REGEX.test(this.leafHash)) {
      throw new MerkleError(MERKLE_ERROR_CODES.INVALID_LEAF, `Invalid leafHash hex format: '${this.leafHash}'`);
    }

    if (!HEX_64_REGEX.test(this.expectedRoot)) {
      throw new MerkleError(MERKLE_ERROR_CODES.MALFORMED_PROOF, `Invalid expectedRoot hex format: '${this.expectedRoot}'`);
    }

    if (isNaN(this.leafIndex) || this.leafIndex < 0 || this.leafIndex >= this.totalLeaves) {
      throw new MerkleError(MERKLE_ERROR_CODES.INDEX_OUT_OF_BOUNDS, `Leaf index ${this.leafIndex} out of bounds [0, ${this.totalLeaves})`);
    }

    if (this.treeDepth > MAX_ALLOWED_DEPTH || this.siblings.length > MAX_ALLOWED_DEPTH) {
      throw new MerkleError(MERKLE_ERROR_CODES.DEPTH_EXCEEDED, `Proof depth exceeds maximum allowed limit (${MAX_ALLOWED_DEPTH})`);
    }

    if (this.siblings.length !== this.treeDepth) {
      throw new MerkleError(MERKLE_ERROR_CODES.MALFORMED_PROOF, `Sibling count (${this.siblings.length}) does not match treeDepth (${this.treeDepth})`);
    }

    for (let i = 0; i < this.siblings.length; i++) {
      const s = this.siblings[i];
      if (!s || !['left', 'right'].includes(s.position)) {
        throw new MerkleError(MERKLE_ERROR_CODES.INVALID_SIBLING, `Sibling at index ${i} has invalid position`);
      }
      if (!HEX_64_REGEX.test(s.hash)) {
        throw new MerkleError(MERKLE_ERROR_CODES.INVALID_SIBLING, `Sibling at index ${i} has invalid hash format: '${s.hash}'`);
      }
    }

    return true;
  }

  /**
   * Verify the proof independently.
   * @param {string|object} [leafDataOrHash] - Optional leaf payload or hash to verify against proof.leafHash
   * @param {string} [overrideExpectedRoot] - Optional expected root to verify against
   * @returns {{ valid: boolean, reason?: string, computedRoot: string, expectedRoot: string, leafIndex: number, treeDepth: number }}
   */
  verify(leafDataOrHash = null, overrideExpectedRoot = null) {
    try {
      this.validateStructure();
    } catch (err) {
      return {
        valid: false,
        reason: err.code || MERKLE_ERROR_CODES.MALFORMED_PROOF,
        message: err.message,
        computedRoot: null,
        expectedRoot: this.expectedRoot,
        leafIndex: this.leafIndex,
        treeDepth: this.treeDepth
      };
    }

    // If leafDataOrHash is provided and looks like a 64-char hex, check match
    if (leafDataOrHash && typeof leafDataOrHash === 'string' && HEX_64_REGEX.test(leafDataOrHash)) {
      if (cleanHex(leafDataOrHash) !== this.leafHash) {
        return {
          valid: false,
          reason: MERKLE_ERROR_CODES.INVALID_LEAF,
          message: 'Provided leaf hash does not match proof leafHash',
          computedRoot: null,
          expectedRoot: this.expectedRoot,
          leafIndex: this.leafIndex,
          treeDepth: this.treeDepth
        };
      }
    }

    const targetRoot = cleanHex(overrideExpectedRoot || this.expectedRoot);
    let current = this.leafHash;

    for (let i = 0; i < this.siblings.length; i++) {
      const sib = this.siblings[i];
      const sibHash = sib.hash;

      if (this.version === 1) {
        // Version 1 Legacy: sha256(left + right)
        if (sib.position === 'left') {
          current = sha256(sibHash + current);
        } else {
          current = sha256(current + sibHash);
        }
      } else {
        // Version 2 Canonical: sha256(0x01 || left || right)
        const prefix = Buffer.from([0x01]);
        const leftBuf = Buffer.from(sib.position === 'left' ? sibHash : current, 'hex');
        const rightBuf = Buffer.from(sib.position === 'left' ? current : sibHash, 'hex');
        current = crypto.createHash('sha256').update(Buffer.concat([prefix, leftBuf, rightBuf])).digest('hex');
      }
    }

    const matches = current.toLowerCase() === targetRoot.toLowerCase();

    return {
      valid: matches,
      reason: matches ? null : MERKLE_ERROR_CODES.ROOT_MISMATCH,
      message: matches ? 'Merkle proof verified successfully' : `Computed root '${current}' does not match expected root '${targetRoot}'`,
      computedRoot: current,
      expectedRoot: targetRoot,
      leafIndex: this.leafIndex,
      treeDepth: this.treeDepth
    };
  }

  toJSON() {
    return {
      version: this.version,
      commitmentType: this.commitmentType,
      hashAlgorithm: this.hashAlgorithm,
      leafHash: this.leafHash,
      leafIndex: this.leafIndex,
      totalLeaves: this.totalLeaves,
      treeDepth: this.treeDepth,
      siblings: this.siblings,
      expectedRoot: this.expectedRoot,
      blockHeight: this.blockHeight,
      blockHash: this.blockHash,
      transactionHash: this.transactionHash,
      eventId: this.eventId,
      finality: this.finality,
      timestamp: this.timestamp,
      requestId: this.requestId
    };
  }

  static fromJSON(json) {
    if (!json || typeof json !== 'object') {
      throw new MerkleError(MERKLE_ERROR_CODES.MALFORMED_PROOF, 'Proof JSON must be a non-null object');
    }
    const proof = new MerkleProof(json);
    proof.validateStructure();
    return proof;
  }
}

module.exports = MerkleProof;
