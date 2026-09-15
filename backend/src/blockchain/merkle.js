const crypto = require('crypto');

function sha256(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * Deterministically compute the leaf hash for a transaction.
 */
function hashTransactionLeaf(tx) {
  if (!tx) return sha256('NULL_TRANSACTION');
  if (typeof tx === 'string') return sha256(tx);

  // If tx has a calculateHash method (Transaction instance), use it
  if (typeof tx.calculateHash === 'function') {
    return tx.calculateHash();
  }

  // Handle plain objects deterministically across formats
  const id = tx.transactionId || tx.id || '';
  const sender = tx.sender || tx.beneficiaryId || tx.beneficiary || tx.from || '';
  const receiver = tx.receiver || tx.shopId || tx.shop || tx.to || '';
  const commodity = tx.commodity || tx.item || (tx.payload && (tx.payload.commodity || tx.payload.item)) || '';
  const qty = tx.quantity !== undefined ? tx.quantity : (tx.qty !== undefined ? tx.qty : (tx.payload && tx.payload.quantity));
  const ts = tx.timestamp || tx.time || '';

  const txContent = `${id}:${sender}:${receiver}:${commodity}:${qty}:${ts}`;
  return sha256(txContent);
}

/**
 * Generate full Merkle Tree layers for an array of transactions.
 * @param {Array} transactions 
 * @returns {Array<Array<string>>} Array of levels from leaves to root
 */
function getMerkleTree(transactions) {
  if (!transactions || transactions.length === 0) {
    return [[sha256('EMPTY_TX_POOL')]];
  }

  let leaves = transactions.map(tx => hashTransactionLeaf(tx));
  const tree = [leaves];

  while (leaves.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < leaves.length; i += 2) {
      if (i + 1 < leaves.length) {
        nextLevel.push(sha256(leaves[i] + leaves[i + 1]));
      } else {
        nextLevel.push(sha256(leaves[i] + leaves[i])); // Duplicate last leaf if odd
      }
    }
    tree.push(nextLevel);
    leaves = nextLevel;
  }

  return tree;
}

/**
 * Calculate Merkle Root hash (SHA-256) for an array of transactions.
 * @param {Array} transactions 
 * @returns {string} SHA-256 Merkle root hex string
 */
function calculateMerkleRoot(transactions) {
  const tree = getMerkleTree(transactions);
  const rootLevel = tree[tree.length - 1];
  return rootLevel[0];
}

module.exports = {
  sha256,
  hashTransactionLeaf,
  getMerkleTree,
  calculateMerkleRoot
};

