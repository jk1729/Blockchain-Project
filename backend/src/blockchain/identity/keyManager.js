const crypto = require('crypto');

/**
 * Derive deterministic PDSChain address from a public key.
 * Format: PDS1 + 40-hex-character SHA-256 digest
 * 
 * @param {string|Buffer} publicKey - Public key in hex or buffer format
 * @returns {string} PDSChain address (e.g. PDS1a1b2c3d4e5...)
 */
function deriveAddress(publicKey) {
  if (!publicKey) {
    throw new Error('Public key is required to derive address');
  }
  const keyStr = typeof publicKey === 'string' ? publicKey : publicKey.toString('hex');
  const hash = crypto.createHash('sha256').update(`PDSCHAIN_ADDR:${keyStr}`).digest('hex');
  return `PDS1${hash.substring(0, 40).toLowerCase()}`;
}

/**
 * Generate a new random Ed25519 keypair and derived address.
 * @returns {{ publicKey: string, privateKey: string, address: string }}
 */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  const publicKeyHex = publicKey.toString('hex');
  const address = deriveAddress(publicKeyHex);

  return {
    publicKey: publicKeyHex,
    privateKey, // PKCS8 PEM string
    address
  };
}

/**
 * In-memory development keystore for deterministic demo identities.
 * Used for development/demo shops, warehouses, validators, and citizens.
 */
const devKeystore = new Map();
const devKeystoreByAddress = new Map();

/**
 * Deterministically generate or retrieve a development keypair for an entity ID.
 * @param {string} entityId - e.g. 'FPS-101', 'WH-001', 'VAL-01', 'BEN-1001'
 * @param {string} entityType - 'SHOP' | 'WAREHOUSE' | 'VALIDATOR' | 'BENEFICIARY' | 'SYSTEM'
 * @returns {{ entityId: string, entityType: string, address: string, publicKey: string, privateKey: string }}
 */
function getOrCreateDevParticipant(entityId, entityType = 'SHOP') {
  const key = String(entityId).toUpperCase().trim();
  if (devKeystore.has(key)) {
    const existing = devKeystore.get(key);
    devKeystoreByAddress.set(existing.address, existing);
    return existing;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`Deterministic development keys are strictly prohibited in production mode for '${key}'. Provision a genuine identity.`);
  }

  // Derive deterministic development keypair from seed string for consistent tests
  // Using Ed25519 with deterministic seed via crypto.generateKeyPairSync with seed or HMAC-derived key
  // Node crypto Ed25519 keygen with deterministic PKCS8:
  const seed = crypto.createHash('sha256').update(`PDSCHAIN_DEV_KEY:${key}:${entityType}`).digest();
  
  // Create deterministic Ed25519 private key from 32-byte seed in PKCS#8 format
  // Ed25519 PKCS8 DER prefix: 302e020100300506032b657004220420
  const pkcs8DerHeader = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8DerHeader, seed]);
  
  const privateKeyObj = crypto.createPrivateKey({
    key: pkcs8Der,
    format: 'der',
    type: 'pkcs8'
  });

  const publicKeyObj = crypto.createPublicKey(privateKeyObj);
  const publicKeyDer = publicKeyObj.export({ type: 'spki', format: 'der' });
  const publicKeyHex = publicKeyDer.toString('hex');
  const privateKeyPem = privateKeyObj.export({ type: 'pkcs8', format: 'pem' });
  const address = deriveAddress(publicKeyHex);

  const participant = {
    entityId: key,
    entityType: entityType.toUpperCase(),
    address,
    publicKey: publicKeyHex,
    privateKey: privateKeyPem
  };

  devKeystore.set(key, participant);
  // Also index by address for reverse lookup
  devKeystore.set(address, participant);

  return participant;
}

/**
 * Retrieve public participant info (Never returns private key).
 */
function getPublicParticipantInfo(idOrAddress) {
  const key = String(idOrAddress).trim();
  let participant = devKeystore.get(key) || devKeystore.get(key.toUpperCase());
  if (!participant) {
    if (/^(FPS|WH|VAL|BEN)-/i.test(key)) {
      const type = key.startsWith('FPS') ? 'SHOP' : (key.startsWith('WH') ? 'WAREHOUSE' : (key.startsWith('VAL') ? 'VALIDATOR' : 'BENEFICIARY'));
      participant = getOrCreateDevParticipant(key, type);
    }
  }
  if (!participant) return null;
  return {
    entityId: participant.entityId,
    entityType: participant.entityType,
    address: participant.address,
    publicKey: participant.publicKey
  };
}

/**
 * Retrieve participant by derived address
 */
function getParticipantByAddress(address) {
  if (!address) return null;
  return devKeystoreByAddress.get(address) || null;
}

/**
 * Retrieve private key for internal signing only (NEVER expose to API).
 */
function getParticipantPrivateKey(idOrAddress) {
  const key = String(idOrAddress).trim();
  let participant = devKeystore.get(key) || devKeystore.get(key.toUpperCase());
  if (!participant && /^(FPS|WH|VAL|BEN)-/i.test(key)) {
    const type = key.startsWith('FPS') ? 'SHOP' : (key.startsWith('WH') ? 'WAREHOUSE' : (key.startsWith('VAL') ? 'VALIDATOR' : 'BENEFICIARY'));
    participant = getOrCreateDevParticipant(key, type);
  }
  return participant ? participant.privateKey : null;
}

/**
 * Register a provisioned production or custom participant identity.
 */
function registerCustomParticipant(participant) {
  if (!participant || !participant.entityId) {
    throw new Error('Invalid participant to register');
  }
  const key = String(participant.entityId).toUpperCase().trim();
  devKeystore.set(key, participant);
  if (participant.address) {
    devKeystoreByAddress.set(participant.address, participant);
  }
  return participant;
}

module.exports = {
  deriveAddress,
  generateKeyPair,
  getOrCreateDevParticipant,
  getPublicParticipantInfo,
  getParticipantByAddress,
  getParticipantPrivateKey,
  registerCustomParticipant
};
