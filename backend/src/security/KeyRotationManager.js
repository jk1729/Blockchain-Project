/**
 * PDSChain KeyRotationManager (Phase 12)
 * 
 * Manages Ed25519 consensus key rotation with historical public key retention:
 * - Deterministic epoch/height-based key activation.
 * - Historical public key indexing so historical blocks and FBA quorum certificates
 *   remain verifiable forever across rotations.
 * - Staged key preparation and atomic height-triggered activation.
 * - Cryptographic rotation announcement signing with active key.
 * - Complete redaction: private keys are never exposed.
 */

const crypto = require('crypto');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { deriveAddress } = require('../blockchain/identity/keyManager');

class KeyRotationError extends Error {
  constructor(message, code = 'KEY_ROTATION_ERROR') {
    super(message);
    this.name = 'KeyRotationError';
    this.code = code;
  }
}

class KeyRotationManager extends EventEmitter {
  /**
   * @param {object} params
   * @param {string} params.validatorId
   * @param {string} params.initialPublicKey - Hex SPKI DER
   * @param {string} [params.initialPrivateKey] - Ed25519 PKCS8 PEM
   * @param {string} [params.initialAddress] - PDS1 address
   * @param {number} [params.startHeight=0]
   */
  constructor(params = {}) {
    super();
    this.validatorId = String(params.validatorId || '').toUpperCase().trim();
    if (!this.validatorId) {
      throw new KeyRotationError('validatorId is required for KeyRotationManager', 'INVALID_VALIDATOR_ID');
    }

    if (!params.initialPublicKey) {
      throw new KeyRotationError('initialPublicKey is required for KeyRotationManager', 'MISSING_INITIAL_KEY');
    }

    const startHeight = typeof params.startHeight === 'number' ? params.startHeight : 0;
    const initialAddress = params.initialAddress || deriveAddress(params.initialPublicKey);

    // Active key entry
    this.activeKey = {
      publicKey: params.initialPublicKey,
      privateKey: params.initialPrivateKey || null,
      address: initialAddress,
      startHeight,
      endHeight: Infinity
    };

    // Historical key entries: [ { publicKey, address, startHeight, endHeight } ]
    this.history = [
      {
        publicKey: this.activeKey.publicKey,
        address: this.activeKey.address,
        startHeight: this.activeKey.startHeight,
        endHeight: Infinity
      }
    ];

    // Staged key awaiting activation at activationHeight
    this.stagedKey = null; // { publicKey, privateKey, address, activationHeight, preparedAt }
  }

  /**
   * Stage a new consensus key to become active at specified height
   * @param {object} newKey 
   * @param {string} newKey.publicKey - Hex SPKI DER
   * @param {string} [newKey.privateKey] - Ed25519 PKCS8 PEM
   * @param {string} [newKey.address] - Derived PDS1 address
   * @param {number} activationHeight - Block height when this key takes effect
   */
  stageKey(newKey, activationHeight) {
    if (!newKey || !newKey.publicKey) {
      throw new KeyRotationError('New key must provide a valid publicKey', 'INVALID_KEY');
    }
    if (typeof activationHeight !== 'number' || activationHeight <= this.activeKey.startHeight) {
      throw new KeyRotationError(
        `Activation height (${activationHeight}) must be greater than current key start height (${this.activeKey.startHeight})`,
        'INVALID_ACTIVATION_HEIGHT'
      );
    }

    const address = newKey.address || deriveAddress(newKey.publicKey);

    this.stagedKey = {
      publicKey: newKey.publicKey,
      privateKey: newKey.privateKey || null,
      address,
      activationHeight,
      preparedAt: Date.now()
    };

    logger.info(`[KeyRotationManager] Staged new consensus key for ${this.validatorId} at activation height #${activationHeight}`);
    this.emit('staged', {
      validatorId: this.validatorId,
      activationHeight,
      publicKey: newKey.publicKey,
      address
    });

    return this.stagedKey;
  }

  /**
   * Create a signed key rotation announcement for consortium gossip
   * @param {number} currentHeight 
   * @returns {object}
   */
  createRotationAnnouncement(currentHeight) {
    if (!this.stagedKey) {
      throw new KeyRotationError('No key is currently staged for rotation', 'NO_STAGED_KEY');
    }
    if (!this.activeKey.privateKey) {
      throw new KeyRotationError('Active private key is required to sign rotation announcement', 'MISSING_ACTIVE_PRIVATE_KEY');
    }

    const payload = {
      validatorId: this.validatorId,
      oldPublicKey: this.activeKey.publicKey,
      newPublicKey: this.stagedKey.publicKey,
      newAddress: this.stagedKey.address,
      activationHeight: this.stagedKey.activationHeight,
      announcedAtHeight: currentHeight,
      timestamp: Date.now()
    };

    const digest = crypto.createHash('sha256').update(JSON.stringify(payload)).digest();
    const signature = crypto.sign(null, digest, crypto.createPrivateKey(this.activeKey.privateKey)).toString('hex');

    return {
      payload,
      signature
    };
  }

  /**
   * Check and activate staged key if current chain height reached or surpassed activationHeight
   * @param {number} currentHeight 
   * @returns {boolean} Whether rotation occurred
   */
  checkAndActivate(currentHeight) {
    if (!this.stagedKey) return false;

    if (currentHeight >= this.stagedKey.activationHeight) {
      this.activateKey(currentHeight);
      return true;
    }
    return false;
  }

  /**
   * Force activation of the staged key
   * @param {number} activationHeight 
   */
  activateKey(activationHeight) {
    if (!this.stagedKey) {
      throw new KeyRotationError('No key is currently staged to activate', 'NO_STAGED_KEY');
    }

    const oldKey = this.activeKey;
    const transitionHeight = typeof activationHeight === 'number' ? activationHeight : this.stagedKey.activationHeight;

    // Close previous active key range in history
    oldKey.endHeight = transitionHeight - 1;
    const historyEntry = this.history.find(h => h.publicKey === oldKey.publicKey && h.endHeight === Infinity);
    if (historyEntry) {
      historyEntry.endHeight = transitionHeight - 1;
    }

    // Set new active key
    this.activeKey = {
      publicKey: this.stagedKey.publicKey,
      privateKey: this.stagedKey.privateKey,
      address: this.stagedKey.address,
      startHeight: transitionHeight,
      endHeight: Infinity
    };

    // Add new entry to history
    this.history.push({
      publicKey: this.activeKey.publicKey,
      address: this.activeKey.address,
      startHeight: transitionHeight,
      endHeight: Infinity
    });

    const activatedRecord = {
      validatorId: this.validatorId,
      activatedAtHeight: transitionHeight,
      oldPublicKey: oldKey.publicKey,
      newPublicKey: this.activeKey.publicKey,
      newAddress: this.activeKey.address
    };

    this.stagedKey = null;

    logger.info(`[KeyRotationManager] Activated new consensus key for ${this.validatorId} at height #${transitionHeight}`);
    this.emit('activated', activatedRecord);

    return activatedRecord;
  }

  /**
   * Resolve public key and address that was valid at a specific block height
   * @param {number} height 
   * @returns {{ publicKey: string, address: string, startHeight: number, endHeight: number } | null}
   */
  getPublicKeyForHeight(height) {
    const target = typeof height === 'number' ? height : 0;

    // Search historical records
    for (const record of this.history) {
      if (target >= record.startHeight && target <= record.endHeight) {
        return {
          publicKey: record.publicKey,
          address: record.address,
          startHeight: record.startHeight,
          endHeight: record.endHeight
        };
      }
    }

    // Fallback to active key if target is within current range
    if (target >= this.activeKey.startHeight) {
      return {
        publicKey: this.activeKey.publicKey,
        address: this.activeKey.address,
        startHeight: this.activeKey.startHeight,
        endHeight: this.activeKey.endHeight
      };
    }

    return null;
  }

  /**
   * Safe status summary for health APIs and metrics
   */
  getStatus() {
    return {
      validatorId: this.validatorId,
      currentPublicKey: this.activeKey.publicKey,
      currentAddress: this.activeKey.address,
      currentStartHeight: this.activeKey.startHeight,
      hasStagedKey: Boolean(this.stagedKey),
      stagedActivationHeight: this.stagedKey ? this.stagedKey.activationHeight : null,
      rotationCount: Math.max(0, this.history.length - 1),
      historyLength: this.history.length
    };
  }

  toJSON() {
    return this.getStatus();
  }
}

module.exports = {
  KeyRotationManager,
  KeyRotationError
};

