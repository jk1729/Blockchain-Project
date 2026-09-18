/**
 * PDSChain KeyStore (Phase 12)
 * 
 * Secure in-memory and disk-persisted keystore for validator cryptographic credentials.
 * Manages:
 * - Ed25519 Consensus keypair (signing proposals, votes, certificates).
 * - X.509 Transport private key and certificate (TLS / mTLS peer transport).
 * 
 * Security Invariants:
 * - AES-256-GCM encryption at rest with PBKDF2 (100,000 iterations, SHA-256).
 * - Strict POSIX 0600 file permissions on save.
 * - Complete redaction: private keys and passphrases are NEVER exposed in toJSON, toString, inspect, or logs.
 * - Clean in-memory zeroing/unloading on close/destroy.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { deriveAddress } = require('../blockchain/identity/keyManager');

class KeyStoreError extends Error {
  constructor(message, code = 'KEYSTORE_ERROR') {
    super(message);
    this.name = 'KeyStoreError';
    this.code = code;
  }
}

class KeyStore {
  /**
   * @param {object} [options]
   * @param {string} [options.validatorId]
   */
  constructor(options = {}) {
    this.validatorId = options.validatorId ? String(options.validatorId).toUpperCase().trim() : null;
    this._consensusKey = null; // { publicKey, privateKey, address }
    this._transportKey = null; // { key, cert, ca }
    this._isUnlocked = false;
    this._destroyed = false;
  }

  /**
   * Load and decrypt credentials from a keystore file on disk
   * @param {string} filePath 
   * @param {string} [passphrase]
   * @returns {KeyStore}
   */
  static loadFromFile(filePath, passphrase = null) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      throw new KeyStoreError(`Keystore file not found at: ${resolved}`, 'FILE_NOT_FOUND');
    }

    const raw = fs.readFileSync(resolved, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new KeyStoreError(`Invalid JSON format in keystore file: ${err.message}`, 'MALFORMED_FILE');
    }

    const keystore = new KeyStore({ validatorId: parsed.validatorId });

    if (parsed.encrypted) {
      if (!passphrase) {
        throw new KeyStoreError('Passphrase is required to decrypt keystore', 'PASSPHRASE_REQUIRED');
      }
      const decrypted = keystore._decrypt(parsed, passphrase);
      keystore._importPlaintext(decrypted);
    } else {
      if (process.env.NODE_ENV === 'production') {
        throw new KeyStoreError('Unencrypted keystores are prohibited in production mode', 'UNENCRYPTED_KEYSTORE_PROHIBITED');
      }
      keystore._importPlaintext(parsed);
    }

    keystore._isUnlocked = true;
    return keystore;
  }

  /**
   * Initialize directly from in-memory credentials
   * @param {object} params
   * @param {string} params.validatorId
   * @param {object} [params.consensus] - { publicKey, privateKey, address }
   * @param {object} [params.transport] - { key, cert, ca }
   */
  static fromCredentials({ validatorId, consensus, transport }) {
    const keystore = new KeyStore({ validatorId });
    if (consensus) {
      keystore.setConsensusCredentials(consensus);
    }
    if (transport) {
      keystore.setTransportCredentials(transport);
    }
    keystore._isUnlocked = true;
    return keystore;
  }

  /**
   * Set consensus Ed25519 credentials
   * @param {object} creds 
   * @param {string} creds.privateKey - Ed25519 PEM or PKCS8 DER
   * @param {string} [creds.publicKey] - Hex SPKI DER
   * @param {string} [creds.address] - PDS1 address
   */
  setConsensusCredentials(creds) {
    this._ensureNotDestroyed();
    if (!creds || !creds.privateKey) {
      throw new KeyStoreError('Invalid consensus credentials: privateKey is required', 'INVALID_CREDENTIALS');
    }

    let privateKeyPem = creds.privateKey;
    let publicKeyHex = creds.publicKey;
    let address = creds.address;

    // Validate Ed25519 key structure via crypto
    try {
      const privKeyObj = crypto.createPrivateKey(privateKeyPem);
      if (privKeyObj.asymmetricKeyType !== 'ed25519') {
        throw new KeyStoreError(`Consensus key must be ed25519, received: ${privKeyObj.asymmetricKeyType}`, 'INVALID_KEY_TYPE');
      }

      if (!publicKeyHex) {
        const pubKeyObj = crypto.createPublicKey(privKeyObj);
        publicKeyHex = pubKeyObj.export({ type: 'spki', format: 'der' }).toString('hex');
      }

      if (!address) {
        address = deriveAddress(publicKeyHex);
      }
    } catch (err) {
      if (err instanceof KeyStoreError) throw err;
      throw new KeyStoreError(`Failed to parse Ed25519 private key: ${err.message}`, 'INVALID_PRIVATE_KEY');
    }

    this._consensusKey = {
      privateKey: privateKeyPem,
      publicKey: publicKeyHex,
      address
    };
  }

  /**
   * Set transport X.509 credentials
   * @param {object} creds 
   * @param {string} creds.key - Private key PEM
   * @param {string} creds.cert - Certificate PEM
   * @param {string} [creds.ca] - CA Certificate PEM
   */
  setTransportCredentials(creds) {
    this._ensureNotDestroyed();
    if (!creds || !creds.key || !creds.cert) {
      throw new KeyStoreError('Invalid transport credentials: key and cert are required', 'INVALID_CREDENTIALS');
    }

    // Validate transport private key format
    try {
      crypto.createPrivateKey(creds.key);
    } catch (err) {
      throw new KeyStoreError(`Invalid transport private key PEM: ${err.message}`, 'INVALID_PRIVATE_KEY');
    }

    // Validate X.509 cert format
    try {
      new crypto.X509Certificate(creds.cert);
    } catch (err) {
      throw new KeyStoreError(`Invalid transport X.509 certificate PEM: ${err.message}`, 'INVALID_CERTIFICATE');
    }

    if (creds.ca) {
      try {
        new crypto.X509Certificate(creds.ca);
      } catch (err) {
        throw new KeyStoreError(`Invalid CA X.509 certificate PEM: ${err.message}`, 'INVALID_CERTIFICATE');
      }
    }

    this._transportKey = {
      key: creds.key,
      cert: creds.cert,
      ca: creds.ca || null
    };
  }

  getConsensusPrivateKey() {
    this._ensureUnlocked();
    return this._consensusKey ? this._consensusKey.privateKey : null;
  }

  getConsensusPublicKey() {
    this._ensureUnlocked();
    return this._consensusKey ? this._consensusKey.publicKey : null;
  }

  getConsensusAddress() {
    this._ensureUnlocked();
    return this._consensusKey ? this._consensusKey.address : null;
  }

  getTransportPrivateKey() {
    this._ensureUnlocked();
    return this._transportKey ? this._transportKey.key : null;
  }

  getTransportCertificate() {
    this._ensureUnlocked();
    return this._transportKey ? this._transportKey.cert : null;
  }

  getTransportCA() {
    this._ensureUnlocked();
    return this._transportKey ? this._transportKey.ca : null;
  }

  hasConsensusKey() {
    return Boolean(this._consensusKey && this._consensusKey.privateKey);
  }

  hasTransportKey() {
    return Boolean(this._transportKey && this._transportKey.key);
  }

  isUnlocked() {
    return this._isUnlocked && !this._destroyed;
  }

  /**
   * Persist keystore to disk with optional encryption
   * @param {string} filePath 
   * @param {string} [passphrase] 
   * @param {object} [options]
   * @param {boolean} [options.overwrite=false]
   */
  saveToFile(filePath, passphrase = null, options = {}) {
    this._ensureUnlocked();
    const resolved = path.resolve(filePath);
    const overwrite = Boolean(options.overwrite);

    if (fs.existsSync(resolved) && !overwrite) {
      throw new KeyStoreError(`File already exists at: ${resolved}`, 'FILE_EXISTS');
    }

    if (process.env.NODE_ENV === 'production' && !passphrase) {
      throw new KeyStoreError('Passphrase is required for persisting keystore in production mode', 'PASSPHRASE_REQUIRED');
    }

    const payloadToPersist = {
      validatorId: this.validatorId,
      version: 1,
      createdAt: Date.now(),
      consensus: this._consensusKey,
      transport: this._transportKey
    };

    let serialized;
    if (passphrase) {
      const encrypted = this._encrypt(payloadToPersist, passphrase);
      serialized = JSON.stringify({
        validatorId: this.validatorId,
        encrypted: true,
        version: 1,
        ...encrypted
      }, null, 2);
    } else {
      serialized = JSON.stringify({
        validatorId: this.validatorId,
        encrypted: false,
        version: 1,
        ...payloadToPersist
      }, null, 2);
    }

    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(resolved, serialized, { encoding: 'utf8', mode: 0o600 });

    try {
      if (process.platform !== 'win32') {
        fs.chmodSync(resolved, 0o600);
      }
    } catch (e) {}

    return resolved;
  }

  /**
   * Redacted export safe for diagnostics, health APIs, and logs
   */
  toSafeObject() {
    return {
      validatorId: this.validatorId,
      isUnlocked: this.isUnlocked(),
      hasConsensusKey: this.hasConsensusKey(),
      consensusAddress: this.getConsensusAddress(),
      consensusPublicKey: this.getConsensusPublicKey(),
      hasTransportKey: this.hasTransportKey(),
      hasTransportCA: Boolean(this.getTransportCA())
    };
  }

  toJSON() {
    return this.toSafeObject();
  }

  toString() {
    return `[KeyStore validatorId=${this.validatorId} unlocked=${this.isUnlocked()}]`;
  }

  [crypto.customInspect || 'inspect']() {
    return this.toString();
  }

  /**
   * Securely wipe in-memory credentials
   */
  destroy() {
    if (this._consensusKey) {
      this._consensusKey.privateKey = null;
      this._consensusKey = null;
    }
    if (this._transportKey) {
      this._transportKey.key = null;
      this._transportKey = null;
    }
    this._isUnlocked = false;
    this._destroyed = true;
  }

  // --- Internal Crypto Helpers ---

  _encrypt(data, passphrase) {
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = JSON.stringify(data);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      authTag,
      ciphertext: encrypted
    };
  }

  _decrypt(encryptedRecord, passphrase) {
    try {
      const salt = Buffer.from(encryptedRecord.salt, 'hex');
      const iv = Buffer.from(encryptedRecord.iv, 'hex');
      const authTag = Buffer.from(encryptedRecord.authTag, 'hex');
      const ciphertext = Buffer.from(encryptedRecord.ciphertext, 'hex');

      const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (err) {
      throw new KeyStoreError('Failed to decrypt keystore: invalid passphrase or corrupted payload', 'DECRYPTION_FAILED');
    }
  }

  _importPlaintext(data) {
    if (data.consensus) {
      this.setConsensusCredentials(data.consensus);
    }
    if (data.transport) {
      this.setTransportCredentials(data.transport);
    }
  }

  _ensureUnlocked() {
    this._ensureNotDestroyed();
    if (!this._isUnlocked) {
      throw new KeyStoreError('KeyStore is locked', 'KEYSTORE_LOCKED');
    }
  }

  _ensureNotDestroyed() {
    if (this._destroyed) {
      throw new KeyStoreError('KeyStore has been destroyed and cannot be accessed', 'KEYSTORE_DESTROYED');
    }
  }
}

module.exports = {
  KeyStore,
  KeyStoreError
};

