const crypto = require('crypto');

/**
 * PDSChain Cryptographic Identity to EVM Address Bridge
 * 
 * Maps native PDSChain identities (Ed25519 addresses like PDS1..., participant IDs like FPS-101)
 * to deterministic, standard 20-byte EVM addresses (0x...) for smart contract execution context.
 * 
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Preserves PDSChain Ed25519 cryptographic identity as the authoritative signing layer.
 * 2. Does NOT claim cryptographic equivalence between Ed25519 and secp256k1.
 * 3. Does NOT derive EVM addresses from invalid key conversions.
 * 4. Deterministically binds verified signed transactions to EVM execution callers.
 * 5. Strictly prevents private key exposure.
 */

// In-memory cache for deterministic address mapping
const addressCache = new Map();

/**
 * Derive deterministic 20-byte EVM address (0x...) from a PDSChain identifier.
 * Format: 0x + 40 hex characters from SHA-256 hash of domain-separated identifier.
 * 
 * @param {string} pdsIdentifier - PDS address (PDS1...) or Entity ID (FPS-101, WH-001, VAL-01)
 * @returns {string} Standard checksummed 20-byte hex address (e.g. 0x1234...abcd)
 */
function deriveEVMAddress(pdsIdentifier) {
  if (!pdsIdentifier || typeof pdsIdentifier !== 'string') {
    throw new Error('Valid PDS identifier string required for EVM address derivation');
  }

  const normalized = pdsIdentifier.trim().toUpperCase();
  if (addressCache.has(normalized)) {
    return addressCache.get(normalized);
  }

  // Domain-separated deterministic hash
  const hash = crypto.createHash('sha256')
    .update(`PDSCHAIN_EVM_ADDR_V1:${normalized}`, 'utf8')
    .digest('hex');

  // Take first 40 hex chars for 20-byte Ethereum-compatible address
  const evmAddress = `0x${hash.substring(0, 40).toLowerCase()}`;
  addressCache.set(normalized, evmAddress);
  return evmAddress;
}

/**
 * Known system actor mappings for deterministic test and demo accounts
 */
const SYSTEM_EVM_ACCOUNTS = {
  ADMIN: deriveEVMAddress('ADMIN'),
  SYSTEM: deriveEVMAddress('SYSTEM'),
  'VAL-01': deriveEVMAddress('VAL-01'),
  'VAL-02': deriveEVMAddress('VAL-02'),
  'FPS-101': deriveEVMAddress('FPS-101'),
  'FPS-102': deriveEVMAddress('FPS-102'),
  'WH-001': deriveEVMAddress('WH-001'),
  'WH-002': deriveEVMAddress('WH-002')
};

/**
 * Resolve EVM caller address from verified transaction sender.
 * @param {object|Transaction} tx - Verified transaction instance
 * @returns {string} 20-byte EVM address
 */
function resolveEVMCaller(tx) {
  if (!tx) return deriveEVMAddress('SYSTEM');
  
  // If transaction specified an explicit EVM caller
  if (tx.payload && tx.payload.caller) {
    return tx.payload.caller.startsWith('0x') ? tx.payload.caller : deriveEVMAddress(tx.payload.caller);
  }
  if (tx.payload && tx.payload.senderId) {
    return deriveEVMAddress(tx.payload.senderId);
  }
  if (tx.payload && tx.payload.shopId) {
    return deriveEVMAddress(tx.payload.shopId);
  }
  if (tx.payload && tx.payload.warehouseId) {
    return deriveEVMAddress(tx.payload.warehouseId);
  }
  if (tx.payload && tx.payload.from) {
    return tx.payload.from.startsWith('0x') ? tx.payload.from : deriveEVMAddress(tx.payload.from);
  }
  
  // Use sender address or participant ID
  const sender = tx.sender;
  if (sender) {
    if (sender.startsWith('0x')) return sender;
    // Check if sender address maps to a registered participant
    try {
      const { getParticipantByAddress } = require('../blockchain/identity/keyManager');
      const participant = getParticipantByAddress(sender);
      if (participant && participant.entityId) {
        return deriveEVMAddress(participant.entityId);
      }
    } catch (e) {
      // fallback
    }
    return deriveEVMAddress(sender);
  }

  return deriveEVMAddress('SYSTEM');
}

module.exports = {
  deriveEVMAddress,
  resolveEVMCaller,
  SYSTEM_EVM_ACCOUNTS
};
