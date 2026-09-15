const { deriveAddress, generateKeyPair, getPublicParticipantInfo } = require('./keyManager');

/**
 * PDSChain Cryptographic Identity
 * 
 * Represents an on-chain participant's public cryptographic identity:
 * - Deterministic PDS1... address
 * - Asymmetric public key (Ed25519)
 * - Associated institutional or actor role (SHOP, WAREHOUSE, VALIDATOR, CITIZEN)
 * 
 * IMPORTANT: Private keys are strictly separated and NEVER stored in Identity instances.
 */
class Identity {
  constructor({ address, publicKey, entityId = null, entityType = 'USER' } = {}) {
    if (!publicKey && !address) {
      throw new Error('Identity requires at least a publicKey or address');
    }

    this.publicKey = publicKey || null;
    this.address = address || (publicKey ? deriveAddress(publicKey) : null);
    this.entityId = entityId;
    this.entityType = String(entityType || 'USER').toUpperCase();
  }

  /**
   * Safe JSON representation for API responses and client consumption.
   * Private keys are NEVER exposed.
   */
  toJSON() {
    return {
      address: this.address,
      publicKey: this.publicKey,
      entityId: this.entityId,
      entityType: this.entityType
    };
  }

  /**
   * Factory: create new random identity with generated keypair
   * @returns {{ identity: Identity, privateKey: string }}
   */
  static createNew(entityType = 'USER', entityId = null) {
    const keyPair = generateKeyPair();
    const identity = new Identity({
      address: keyPair.address,
      publicKey: keyPair.publicKey,
      entityId,
      entityType
    });

    return {
      identity,
      privateKey: keyPair.privateKey
    };
  }

  /**
   * Factory: create from public key
   */
  static fromPublicKey(publicKey, entityId = null, entityType = 'USER') {
    const address = deriveAddress(publicKey);
    return new Identity({
      address,
      publicKey,
      entityId,
      entityType
    });
  }

  /**
   * Factory: lookup known participant
   */
  static lookup(idOrAddress) {
    const info = getPublicParticipantInfo(idOrAddress);
    if (!info) return null;
    return new Identity(info);
  }
}

module.exports = Identity;

