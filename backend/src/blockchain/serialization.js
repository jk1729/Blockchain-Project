const crypto = require('crypto');

/**
 * PDSChain Canonical Serialization Module
 * 
 * Guarantees deterministic, property-order-agnostic serialization for
 * digital signing, signature verification, Merkle hashing, and transaction IDs.
 */

/**
 * Recursively sort object keys and serialize to deterministic JSON.
 * @param {*} value - Any JavaScript value or object
 * @returns {string} Canonical deterministic JSON string
 */
function serializeCanonical(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map(item => serializeCanonical(item));
    return `[${items.join(',')}]`;
  }

  // Value is an object: sort keys lexicographically (ASCII / UTF-16 code units)
  const sortedKeys = Object.keys(value).sort();
  const pairs = sortedKeys
    .filter(k => value[k] !== undefined) // omit undefined properties
    .map(k => `${JSON.stringify(k)}:${serializeCanonical(value[k])}`);

  return `{${pairs.join(',')}}`;
}

/**
 * Compute SHA-256 hash of canonically serialized data
 * @param {*} data 
 * @returns {string} 64-character lowercase SHA-256 hex string
 */
function hashCanonical(data) {
  const canonicalStr = typeof data === 'string' ? data : serializeCanonical(data);
  return crypto.createHash('sha256').update(canonicalStr).digest('hex');
}

/**
 * Extract canonical unsigned transaction payload.
 * Excludes `signature`, `transactionId`, and post-consensus metadata
 * so the signature remains immutable throughout the block commit lifecycle.
 * 
 * @param {object} tx - Transaction or transaction-like object
 * @returns {object} Normalized unsigned transaction fields
 */
function extractUnsignedFields(tx) {
  if (!tx) return {};

  const version = String(tx.version || '1.0');
  const type = String(tx.type || 'DISTRIBUTION').toUpperCase();
  const sender = String(tx.sender || tx.beneficiaryId || tx.from || 'SYSTEM');
  const receiver = String(tx.receiver || tx.shopId || tx.to || 'SYSTEM');
  
  // Extract and normalize business payload
  let rawPayload = {};
  if (tx.payload && typeof tx.payload === 'object') {
    rawPayload = { ...tx.payload };
  } else {
    // If payload details were on root object
    if (tx.commodity || tx.item) rawPayload.commodity = tx.commodity || tx.item;
    if (tx.quantity !== undefined || tx.qty !== undefined) {
      rawPayload.quantity = tx.quantity !== undefined ? tx.quantity : tx.qty;
    }
    if (tx.unit) rawPayload.unit = tx.unit;
    if (tx.name || tx.beneficiaryName) rawPayload.name = tx.name || tx.beneficiaryName;
    if (type === 'CONTRACT_CALL') {
      if (tx.contractAddress) rawPayload.contractAddress = tx.contractAddress;
      if (tx.method) rawPayload.method = tx.method;
      if (tx.args) rawPayload.args = tx.args;
      if (tx.calldata) rawPayload.calldata = tx.calldata;
      if (tx.gasLimit !== undefined) rawPayload.gasLimit = tx.gasLimit;
    }
  }

  // Ensure contract call fields are captured from root if present for CONTRACT_CALL
  if (type === 'CONTRACT_CALL') {
    if (tx.contractAddress && !rawPayload.contractAddress) rawPayload.contractAddress = tx.contractAddress;
    if (tx.method && !rawPayload.method) rawPayload.method = tx.method;
    if (tx.args && !rawPayload.args) rawPayload.args = tx.args;
    if (tx.calldata && !rawPayload.calldata) rawPayload.calldata = tx.calldata;
    if (tx.gasLimit !== undefined && rawPayload.gasLimit === undefined) rawPayload.gasLimit = tx.gasLimit;
  }

  // Exclude post-commit consensus metadata from the signed payload
  const { consensusRound, validators, blockNumber, blockHash, hash, status, ...cleanPayload } = rawPayload;

  // Ensure numeric quantity if formatted as string
  if (typeof cleanPayload.quantity === 'string' && cleanPayload.quantity.includes(' ')) {
    cleanPayload.quantity = parseFloat(cleanPayload.quantity);
  }

  const timestamp = String(tx.timestamp || tx.time || '');
  const nonce = parseInt(tx.nonce, 10) || 0;
  const senderPublicKey = tx.senderPublicKey || rawPayload.senderPublicKey || null;

  return {
    version,
    type,
    sender,
    receiver,
    payload: cleanPayload,
    timestamp,
    nonce,
    ...(senderPublicKey ? { senderPublicKey } : {})
  };
}

/**
 * Serialize an unsigned transaction to its canonical string representation
 * @param {object} tx 
 * @returns {string} Deterministic canonical string
 */
function serializeUnsignedTransaction(tx) {
  const unsignedFields = extractUnsignedFields(tx);
  return serializeCanonical(unsignedFields);
}

/**
 * Derive deterministic transaction ID from canonical unsigned hash
 * @param {string} canonicalHash 
 * @returns {string} Formatted transaction ID
 */
function generateDeterministicTxId(canonicalHash) {
  const cleanHash = (canonicalHash || '').replace(/^0x/, '');
  const shortId = cleanHash.substring(0, 16).toUpperCase();
  return `TXN-${shortId}`;
}

module.exports = {
  serializeCanonical,
  hashCanonical,
  extractUnsignedFields,
  serializeUnsignedTransaction,
  generateDeterministicTxId
};

