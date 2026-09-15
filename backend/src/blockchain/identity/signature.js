const crypto = require('crypto');
const { serializeCanonical, serializeUnsignedTransaction, hashCanonical, generateDeterministicTxId } = require('../serialization');
const { deriveAddress } = require('./keyManager');

const DOMAIN_TRANSACTION = 'PDSCHAIN_TX_V1';
const DOMAIN_BLOCK = 'PDSCHAIN_BLOCK_V1';
const DOMAIN_VOTE = 'PDSCHAIN_VOTE_V1';

/**
 * Helper to normalize and construct a KeyObject from private key input
 */
function createPrivateKeyObj(privateKey) {
  if (!privateKey) throw new Error('Private key is required');
  if (typeof privateKey === 'string') {
    if (privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      return crypto.createPrivateKey(privateKey);
    }
    // Hex representation
    return crypto.createPrivateKey({
      key: Buffer.from(privateKey, 'hex'),
      format: 'der',
      type: 'pkcs8'
    });
  }
  return privateKey;
}

/**
 * Helper to normalize and construct a KeyObject from public key input
 */
function createPublicKeyObj(publicKey) {
  if (!publicKey) throw new Error('Public key is required');
  if (typeof publicKey === 'string') {
    const pubKeyHex = publicKey.replace(/^0x/, '');
    if (publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      return crypto.createPublicKey(publicKey);
    }
    return crypto.createPublicKey({
      key: Buffer.from(pubKeyHex, 'hex'),
      format: 'der',
      type: 'spki'
    });
  }
  return publicKey;
}

/**
 * Export public key hex from a KeyObject or string
 */
function exportPublicKeyHex(publicKey) {
  if (typeof publicKey === 'string') {
    if (publicKey.includes('-----BEGIN PUBLIC KEY-----')) {
      const pubKeyObj = crypto.createPublicKey(publicKey);
      return pubKeyObj.export({ type: 'spki', format: 'der' }).toString('hex');
    }
    return publicKey.replace(/^0x/, '');
  }
  return publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
}

/**
 * Sign a blockchain transaction with an Ed25519 private key.
 * 
 * Flow:
 * 1. Extract and canonically serialize unsigned fields.
 * 2. Hash unsigned canonical representation to derive deterministic Transaction ID.
 * 3. Cryptographically sign the canonical payload with Ed25519.
 * 4. Attach signature and deterministic ID to the transaction.
 * 
 * @param {Transaction|object} transaction - Transaction to sign
 * @param {string|crypto.KeyObject} privateKey - Ed25519 private key (PEM or KeyObject)
 * @param {string} [publicKeyHex] - Optional sender public key hex
 * @returns {Transaction|object} Signed transaction
 */
function signTransaction(transaction, privateKey, publicKeyHex = null) {
  if (!transaction) throw new Error('Transaction object is required for signing');
  if (!privateKey) throw new Error('Private key is required for signing');

  // 1. Canonically serialize unsigned transaction
  const canonicalUnsignedStr = serializeUnsignedTransaction(transaction);
  const canonicalHash = hashCanonical(canonicalUnsignedStr);

  // 2. Sign canonical data with Ed25519
  const dataBuffer = Buffer.from(canonicalUnsignedStr, 'utf8');
  const privateKeyObj = createPrivateKeyObj(privateKey);

  const signatureBuffer = crypto.sign(null, dataBuffer, privateKeyObj);
  const signatureHex = signatureBuffer.toString('hex');

  // 3. Derive deterministic Transaction ID
  const deterministicTxId = generateDeterministicTxId(canonicalHash);

  // 4. Attach signature, transactionId, and optional senderPublicKey
  if (typeof transaction.setSignature === 'function') {
    transaction.setSignature(signatureHex, deterministicTxId, publicKeyHex);
  } else {
    transaction.signature = signatureHex;
    transaction.transactionId = deterministicTxId;
    transaction.id = deterministicTxId;
    if (publicKeyHex) {
      transaction.senderPublicKey = publicKeyHex;
    }
  }

  return transaction;
}

/**
 * Verify cryptographic digital signature of a transaction.
 * 
 * @param {Transaction|object} transaction - Transaction to verify
 * @param {string|crypto.KeyObject} [publicKey] - Sender's public key (hex or KeyObject)
 * @returns {{ valid: boolean, reason?: string, transactionId?: string, canonicalHash?: string }}
 */
function verifyTransactionSignature(transaction, publicKey = null) {
  if (!transaction) {
    return { valid: false, reason: 'Transaction is null or undefined' };
  }

  const signature = transaction.signature;
  if (!signature || typeof signature !== 'string' || signature.trim() === '') {
    return { valid: false, reason: 'MISSING_TRANSACTION_SIGNATURE' };
  }

  // Resolve public key
  const pubKeyInput = publicKey || transaction.senderPublicKey || (transaction.payload && transaction.payload.senderPublicKey);
  if (!pubKeyInput) {
    return { valid: false, reason: 'MISSING_SENDER_PUBLIC_KEY' };
  }

  let publicKeyObj;
  let pubKeyHex;
  try {
    publicKeyObj = createPublicKeyObj(pubKeyInput);
    pubKeyHex = exportPublicKeyHex(publicKeyObj);
  } catch (err) {
    return { valid: false, reason: `INVALID_PUBLIC_KEY_FORMAT: ${err.message}` };
  }

  // Check sender address relationship if sender starts with PDS1
  const sender = String(transaction.sender || transaction.beneficiaryId || transaction.from || '');
  if (sender.startsWith('PDS1')) {
    const derivedAddr = deriveAddress(pubKeyHex);
    if (derivedAddr.toLowerCase() !== sender.toLowerCase()) {
      return {
        valid: false,
        reason: `SENDER_ADDRESS_MISMATCH: Sender address '${sender}' does not match address '${derivedAddr}' derived from public key`
      };
    }
  }

  // Canonically serialize unsigned transaction
  const canonicalUnsignedStr = serializeUnsignedTransaction(transaction);
  const canonicalHash = hashCanonical(canonicalUnsignedStr);
  const expectedTxId = generateDeterministicTxId(canonicalHash);

  // Check transaction ID consistency if set
  if (transaction.transactionId && transaction.transactionId.startsWith('TXN-') && transaction.transactionId.length === 20) {
    if (transaction.transactionId !== expectedTxId) {
      return {
        valid: false,
        reason: `TRANSACTION_ID_MISMATCH: Expected '${expectedTxId}' for canonical payload, got '${transaction.transactionId}'`
      };
    }
  }

  // Verify signature against canonical string
  try {
    const dataBuffer = Buffer.from(canonicalUnsignedStr, 'utf8');
    const sigBuffer = Buffer.from(signature.replace(/^0x/, ''), 'hex');
    const isVerified = crypto.verify(null, dataBuffer, publicKeyObj, sigBuffer);

    if (!isVerified) {
      return { valid: false, reason: 'INVALID_TRANSACTION_SIGNATURE' };
    }

    return {
      valid: true,
      transactionId: expectedTxId,
      canonicalHash
    };
  } catch (err) {
    return { valid: false, reason: `SIGNATURE_VERIFICATION_ERROR: ${err.message}` };
  }
}

/**
 * Normalize and extract unsigned block proposal header for signing
 */
function extractUnsignedProposalPayload(proposal) {
  if (!proposal) return {};
  const version = parseInt(proposal.version, 10) || 1;
  const blockNumber = parseInt(proposal.blockNumber !== undefined ? proposal.blockNumber : proposal.index, 10) || 0;
  const previousHash = String(proposal.previousHash || '');
  const timestamp = String(proposal.timestamp || '');
  const merkleRoot = String(proposal.merkleRoot || '');
  const stateRoot = String(proposal.stateRoot || '');
  const proposerId = String(proposal.proposerId || 'VAL-01');
  const proposerAddress = String(proposal.proposerAddress || '');
  const round = parseInt(proposal.round, 10) || 0;

  return {
    domain: DOMAIN_BLOCK,
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
}

/**
 * Sign a candidate block proposal by the proposer's Ed25519 private key
 * @param {object} proposal - Proposal header or Block
 * @param {string|crypto.KeyObject} privateKey - Proposer's Ed25519 private key
 * @returns {string} Hex-encoded Ed25519 signature
 */
function signBlockProposal(proposal, privateKey) {
  if (!proposal) throw new Error('Proposal object is required for signing');
  if (!privateKey) throw new Error('Private key is required for signing');

  const unsignedPayload = extractUnsignedProposalPayload(proposal);
  const canonicalStr = serializeCanonical(unsignedPayload);
  const dataBuffer = Buffer.from(canonicalStr, 'utf8');
  const privateKeyObj = createPrivateKeyObj(privateKey);

  const signatureBuffer = crypto.sign(null, dataBuffer, privateKeyObj);
  return signatureBuffer.toString('hex');
}

/**
 * Verify a block proposal signature against the proposer's public key
 * @param {object} proposal 
 * @param {string} signature 
 * @param {string|crypto.KeyObject} publicKey 
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyBlockProposalSignature(proposal, signature, publicKey) {
  if (!proposal) return { valid: false, reason: 'Proposal is null or undefined' };
  if (!signature || typeof signature !== 'string' || signature.trim() === '') {
    return { valid: false, reason: 'MISSING_PROPOSER_SIGNATURE' };
  }
  if (!publicKey) return { valid: false, reason: 'MISSING_PROPOSER_PUBLIC_KEY' };

  try {
    const publicKeyObj = createPublicKeyObj(publicKey);
    const pubKeyHex = exportPublicKeyHex(publicKeyObj);

    // Verify proposerAddress if provided and starts with PDS1
    const proposerAddress = proposal.proposerAddress;
    if (proposerAddress && proposerAddress.startsWith('PDS1')) {
      const derivedAddr = deriveAddress(pubKeyHex);
      if (derivedAddr.toLowerCase() !== proposerAddress.toLowerCase()) {
        return {
          valid: false,
          reason: `PROPOSER_ADDRESS_MISMATCH: Proposer address '${proposerAddress}' does not match address '${derivedAddr}' derived from public key`
        };
      }
    }

    const unsignedPayload = extractUnsignedProposalPayload(proposal);
    const canonicalStr = serializeCanonical(unsignedPayload);
    const dataBuffer = Buffer.from(canonicalStr, 'utf8');
    const sigBuffer = Buffer.from(signature.replace(/^0x/, ''), 'hex');

    const isVerified = crypto.verify(null, dataBuffer, publicKeyObj, sigBuffer);
    if (!isVerified) {
      return { valid: false, reason: 'INVALID_PROPOSER_SIGNATURE' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `PROPOSER_SIGNATURE_VERIFICATION_ERROR: ${err.message}` };
  }
}

/**
 * Extract canonical unsigned validator vote payload
 */
function extractUnsignedVotePayload(vote) {
  if (!vote) return {};
  return {
    domain: DOMAIN_VOTE,
    validatorId: String(vote.validatorId || ''),
    validatorAddress: String(vote.validatorAddress || ''),
    validatorPublicKey: String(vote.validatorPublicKey || '').replace(/^0x/, ''),
    proposalId: String(vote.proposalId || ''),
    blockNumber: parseInt(vote.blockNumber !== undefined ? vote.blockNumber : vote.blockIndex, 10) || 0,
    blockHash: String(vote.blockHash || ''),
    stateRoot: String(vote.stateRoot || ''),
    round: parseInt(vote.round, 10) || 0,
    vote: String(vote.vote || 'ACCEPT').toUpperCase(),
    reason: vote.reason ? String(vote.reason) : ''
  };
}

/**
 * Sign a validator vote statement using the validator's Ed25519 private key
 * @param {object} votePayload 
 * @param {string|crypto.KeyObject} privateKey 
 * @returns {string} Hex-encoded Ed25519 signature
 */
function signValidatorVote(votePayload, privateKey) {
  if (!votePayload) throw new Error('Vote payload is required for signing');
  if (!privateKey) throw new Error('Private key is required for signing');

  const unsignedPayload = extractUnsignedVotePayload(votePayload);
  const canonicalStr = serializeCanonical(unsignedPayload);
  const dataBuffer = Buffer.from(canonicalStr, 'utf8');
  const privateKeyObj = createPrivateKeyObj(privateKey);

  const signatureBuffer = crypto.sign(null, dataBuffer, privateKeyObj);
  return signatureBuffer.toString('hex');
}

/**
 * Verify a validator vote signature against the validator's public key
 * @param {object} votePayload 
 * @param {string} signature 
 * @param {string|crypto.KeyObject} publicKey 
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyValidatorVoteSignature(votePayload, signature, publicKey) {
  if (!votePayload) return { valid: false, reason: 'Vote payload is null or undefined' };
  if (!signature || typeof signature !== 'string' || signature.trim() === '') {
    return { valid: false, reason: 'MISSING_VOTE_SIGNATURE' };
  }
  if (!publicKey) return { valid: false, reason: 'MISSING_VALIDATOR_PUBLIC_KEY' };

  try {
    const publicKeyObj = createPublicKeyObj(publicKey);
    const pubKeyHex = exportPublicKeyHex(publicKeyObj);

    // Verify validatorAddress if provided and starts with PDS1
    const validatorAddress = votePayload.validatorAddress;
    if (validatorAddress && validatorAddress.startsWith('PDS1')) {
      const derivedAddr = deriveAddress(pubKeyHex);
      if (derivedAddr.toLowerCase() !== validatorAddress.toLowerCase()) {
        return {
          valid: false,
          reason: `VALIDATOR_ADDRESS_MISMATCH: Address '${validatorAddress}' does not match address '${derivedAddr}' derived from public key`
        };
      }
    }

    const unsignedPayload = extractUnsignedVotePayload(votePayload);
    const canonicalStr = serializeCanonical(unsignedPayload);
    const dataBuffer = Buffer.from(canonicalStr, 'utf8');
    const sigBuffer = Buffer.from(signature.replace(/^0x/, ''), 'hex');

    const isVerified = crypto.verify(null, dataBuffer, publicKeyObj, sigBuffer);
    if (!isVerified) {
      return { valid: false, reason: 'INVALID_VALIDATOR_VOTE_SIGNATURE' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `VALIDATOR_VOTE_VERIFICATION_ERROR: ${err.message}` };
  }
}

module.exports = {
  DOMAIN_TRANSACTION,
  DOMAIN_BLOCK,
  DOMAIN_VOTE,
  signTransaction,
  verifyTransactionSignature,
  extractUnsignedProposalPayload,
  signBlockProposal,
  verifyBlockProposalSignature,
  extractUnsignedVotePayload,
  signValidatorVote,
  verifyValidatorVoteSignature
};
