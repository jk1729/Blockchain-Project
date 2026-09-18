/**
 * PDSChain Merkle Tree Core Module (Phase 16)
 * 
 * Supports Version 1 (v1 legacy compatible) and Version 2 (v2 domain-separated).
 */

const crypto = require('crypto');
const MerkleProof = require('./MerkleProof');
const { MERKLE_ERROR_CODES, MerkleError } = require('./MerkleErrors');

const HEX_64_REGEX = /^(0x)?[0-9a-fA-F]{64}$/;

function cleanHex(h) {
  if (typeof h !== 'string') return '';
  return h.startsWith('0x') ? h.slice(2).toLowerCase() : h.toLowerCase();
}

function sha256(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Deterministically compute the leaf hash for a transaction.
 */
function hashTransactionLeaf(tx, version = 1) {
  if (!tx) return sha256('NULL_TRANSACTION');
  if (typeof tx === 'string') return sha256(tx);

  // If tx has a calculateHash method (Transaction instance), use it
  if (typeof tx.calculateHash === 'function') {
    return tx.calculateHash();
  }

  // Handle receipt leaf if passed
  if (tx.receiptHash && !tx.transactionId && !tx.sender) {
    return sha256(tx.receiptHash);
  }

  // Handle plain objects deterministically across formats
  const id = tx.transactionId || tx.id || tx.txId || '';
  const sender = tx.sender || tx.beneficiaryId || tx.beneficiary || tx.from || '';
  const receiver = tx.receiver || tx.shopId || tx.shop || tx.to || '';
  const commodity = tx.commodity || tx.item || (tx.payload && (tx.payload.commodity || tx.payload.item)) || '';
  const qty = tx.quantity !== undefined ? tx.quantity : (tx.qty !== undefined ? tx.qty : (tx.payload && tx.payload.quantity));
  const ts = tx.timestamp || tx.time || '';

  const txContent = `${id}:${sender}:${receiver}:${commodity}:${qty}:${ts}`;
  
  if (version === 2) {
    const prefix = Buffer.from([0x00]);
    const contentBuf = Buffer.from(txContent, 'utf8');
    return crypto.createHash('sha256').update(Buffer.concat([prefix, contentBuf])).digest('hex');
  }

  return sha256(txContent);
}

/**
 * Deterministically compute the leaf hash for an EVM execution receipt.
 */
function hashReceiptLeaf(receipt, version = 1) {
  if (!receipt) return sha256('NULL_RECEIPT');
  if (typeof receipt === 'string') return sha256(receipt);
  
  const rHash = receipt.receiptHash || (typeof receipt.calculateHash === 'function' ? receipt.calculateHash() : null);
  if (rHash) {
    if (version === 2) {
      const prefix = Buffer.from([0x00]);
      const hBuf = Buffer.from(cleanHex(rHash), 'hex');
      return crypto.createHash('sha256').update(Buffer.concat([prefix, hBuf])).digest('hex');
    }
    return sha256(rHash);
  }

  const canonicalStr = JSON.stringify({
    transactionId: receipt.transactionId || '',
    contractAddress: receipt.contractAddress || '',
    status: receipt.status || 'SUCCESS',
    gasUsed: Number(receipt.gasUsed) || 0,
    revertReason: receipt.revertReason || null
  });

  return sha256(canonicalStr);
}

/**
 * Deterministically compute the leaf hash for an event log.
 */
function hashEventLeaf(event, version = 1) {
  if (!event) return sha256('NULL_EVENT');
  if (typeof event === 'string') return sha256(event);

  const canonicalStr = JSON.stringify({
    eventId: event.eventId || '',
    blockHeight: event.blockHeight || 0,
    transactionHash: event.transactionHash || '',
    logIndex: event.logIndex !== undefined ? event.logIndex : 0,
    contractAddress: event.contractAddress || '',
    rawTopics: event.rawTopics || [],
    rawData: event.rawData || ''
  });

  if (version === 2) {
    const prefix = Buffer.from([0x00]);
    const cBuf = Buffer.from(canonicalStr, 'utf8');
    return crypto.createHash('sha256').update(Buffer.concat([prefix, cBuf])).digest('hex');
  }

  return sha256(canonicalStr);
}

class MerkleTree {
  /**
   * @param {Array} items - Array of transactions, receipts, or precomputed leaf hashes
   * @param {object} [options]
   * @param {number} [options.version=1] - 1 (legacy) or 2 (domain separated)
   * @param {string} [options.commitmentType='TRANSACTION'] - 'TRANSACTION' | 'RECEIPT' | 'EVENT'
   */
  constructor(items = [], options = {}) {
    this.version = Number(options.version) || 1;
    this.commitmentType = String(options.commitmentType || 'TRANSACTION').toUpperCase();
    this.items = Array.isArray(items) ? items : (items ? [items] : []);
    this.layers = [];
    this.buildTree();
  }

  buildTree() {
    if (this.items.length === 0) {
      const emptyHash = this.version === 2 ? sha256('EMPTY_MERKLE_TREE_V2') : sha256('EMPTY_TX_POOL');
      this.layers = [[emptyHash]];
      return;
    }

    // Convert items into leaf hashes
    let currentLevel = this.items.map(item => {
      if (typeof item === 'string' && HEX_64_REGEX.test(item)) {
        return cleanHex(item);
      }
      if (this.commitmentType === 'RECEIPT') {
        return hashReceiptLeaf(item, this.version);
      }
      if (this.commitmentType === 'EVENT') {
        return hashEventLeaf(item, this.version);
      }
      return hashTransactionLeaf(item, this.version);
    });

    this.layers = [currentLevel];

    while (currentLevel.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(this.hashInternalNodes(currentLevel[i], currentLevel[i + 1]));
        } else {
          // Odd leaf: duplicate last leaf
          nextLevel.push(this.hashInternalNodes(currentLevel[i], currentLevel[i]));
        }
      }
      this.layers.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  hashInternalNodes(leftHex, rightHex) {
    if (this.version === 1) {
      return sha256(leftHex + rightHex);
    }
    const prefix = Buffer.from([0x01]);
    const leftBuf = Buffer.from(cleanHex(leftHex), 'hex');
    const rightBuf = Buffer.from(cleanHex(rightHex), 'hex');
    return crypto.createHash('sha256').update(Buffer.concat([prefix, leftBuf, rightBuf])).digest('hex');
  }

  getRoot() {
    if (this.layers.length === 0) return null;
    const rootLevel = this.layers[this.layers.length - 1];
    return rootLevel[0];
  }

  getLeaves() {
    return this.layers.length > 0 ? this.layers[0] : [];
  }

  getDepth() {
    // Number of sibling steps from leaf to root = layers.length - 1
    return Math.max(0, this.layers.length - 1);
  }

  /**
   * Generate an inclusion proof for a leaf at leafIndex
   * @param {number} leafIndex
   * @param {object} [metadata]
   * @returns {MerkleProof}
   */
  getProof(leafIndex, metadata = {}) {
    const leaves = this.getLeaves();
    if (leafIndex < 0 || leafIndex >= leaves.length) {
      throw new MerkleError(
        MERKLE_ERROR_CODES.INDEX_OUT_OF_BOUNDS,
        `Leaf index ${leafIndex} out of bounds for tree with ${leaves.length} leaves`
      );
    }

    const leafHash = leaves[leafIndex];
    const siblings = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.layers.length - 1; level++) {
      const currentLevel = this.layers[level];
      const isRightSibling = currentIndex % 2 === 0;
      let siblingIndex;

      if (isRightSibling) {
        // We are on the left; sibling is to our right
        siblingIndex = currentIndex + 1 < currentLevel.length ? currentIndex + 1 : currentIndex; // if odd, duplicated
        siblings.push({
          position: 'right',
          hash: currentLevel[siblingIndex]
        });
      } else {
        // We are on the right; sibling is to our left
        siblingIndex = currentIndex - 1;
        siblings.push({
          position: 'left',
          hash: currentLevel[siblingIndex]
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return new MerkleProof({
      version: this.version,
      commitmentType: this.commitmentType,
      hashAlgorithm: 'SHA-256',
      leafHash,
      leafIndex,
      totalLeaves: leaves.length,
      treeDepth: siblings.length,
      siblings,
      expectedRoot: this.getRoot(),
      blockHeight: metadata.blockHeight || null,
      blockHash: metadata.blockHash || null,
      transactionHash: metadata.transactionHash || null,
      eventId: metadata.eventId || null,
      finality: metadata.finality || 'FINALIZED',
      timestamp: metadata.timestamp || new Date().toISOString(),
      requestId: metadata.requestId || null
    });
  }
}

/**
 * Legacy compatibility helper: generates full Merkle Tree layers.
 */
function getMerkleTree(transactions) {
  const tree = new MerkleTree(transactions, { version: 1, commitmentType: 'TRANSACTION' });
  return tree.layers;
}

/**
 * Legacy compatibility helper: calculates SHA-256 Merkle root.
 */
function calculateMerkleRoot(transactions) {
  const tree = new MerkleTree(transactions, { version: 1, commitmentType: 'TRANSACTION' });
  return tree.getRoot();
}

module.exports = {
  MerkleTree,
  hashTransactionLeaf,
  hashReceiptLeaf,
  hashEventLeaf,
  getMerkleTree,
  calculateMerkleRoot,
  sha256
};

