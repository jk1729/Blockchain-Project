const crypto = require('crypto');
const { getParticipantPrivateKey, getPublicParticipantInfo } = require('../blockchain/identity/keyManager');
const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');

const CHALLENGE_TTL_MS = 10000; // 10 seconds

class PeerAuthenticator {
  /**
   * @param {string} localValidatorId - e.g. 'VAL-01'
   * @param {string[]} [authorizedValidators] - Whitelist of allowed validator IDs
   */
  constructor(localValidatorId, authorizedValidators = null) {
    this.localValidatorId = String(localValidatorId).toUpperCase().trim();
    const list = Array.isArray(authorizedValidators) && authorizedValidators.length > 0
      ? authorizedValidators
      : DEFAULT_12_VALIDATORS.map(v => v.validatorId);
    this.authorizedValidators = new Set(list.map(v => String(v).toUpperCase().trim()));
    this.activeChallenges = new Map(); // nonce -> { timestamp, expiresAt }
  }

  /**
   * Generate a secure random 32-byte cryptographic challenge nonce
   * @returns {string} 64-hex-char nonce
   */
  createChallenge() {
    const nonce = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.activeChallenges.set(nonce, {
      timestamp: now,
      expiresAt: now + CHALLENGE_TTL_MS
    });

    // Housekeeping expired challenges
    if (this.activeChallenges.size > 200) {
      for (const [n, c] of this.activeChallenges.entries()) {
        if (now > c.expiresAt) this.activeChallenges.delete(n);
      }
    }

    return nonce;
  }

  /**
   * Consume and validate an issued challenge nonce (single-use replay protection)
   * @param {string} nonce 
   * @returns {boolean}
   */
  consumeChallenge(nonce) {
    if (!nonce || !this.activeChallenges.has(nonce)) {
      return false;
    }
    const record = this.activeChallenges.get(nonce);
    this.activeChallenges.delete(nonce);
    return Date.now() <= record.expiresAt;
  }

  /**
   * Sign a received challenge nonce with the local validator's Ed25519 private key
   * @param {string} nonce - The challenge nonce provided by the remote peer
   * @returns {string} Hex-encoded Ed25519 signature
   */
  signChallenge(nonce) {
    if (!nonce || typeof nonce !== 'string') {
      throw new NetworkError(NetworkErrorCode.CHALLENGE_FAILED, 'Cannot sign null or invalid challenge nonce');
    }

    const privKeyPem = getParticipantPrivateKey(this.localValidatorId);
    if (!privKeyPem) {
      throw new NetworkError(
        NetworkErrorCode.IDENTITY_MISMATCH,
        `Private key not available for local validator '${this.localValidatorId}'`
      );
    }

    const payloadStr = `PDSCHAIN_NET_AUTH:${this.localValidatorId}:${nonce}`;
    const dataBuffer = Buffer.from(payloadStr, 'utf8');

    const privateKeyObj = crypto.createPrivateKey({
      key: privKeyPem,
      format: 'pem',
      type: 'pkcs8'
    });

    const signature = crypto.sign(null, dataBuffer, privateKeyObj);
    return signature.toString('hex');
  }

  /**
   * Cryptographically verify a remote peer's challenge response
   * @param {string} remoteValidatorId - Claimed validator ID (e.g. 'VAL-02')
   * @param {string} nonce - The challenge nonce that was sent to the remote peer
   * @param {string} signature - Remote peer's signature
   * @returns {{ valid: boolean, address: string, publicKey: string }}
   */
  verifyChallenge(remoteValidatorId, nonce, signature) {
    const vId = String(remoteValidatorId || '').toUpperCase().trim();

    if (!vId) {
      throw new NetworkError(NetworkErrorCode.UNAUTHORIZED_PEER, 'Remote peer validatorId cannot be empty');
    }

    if (!this.authorizedValidators.has(vId)) {
      throw new NetworkError(
        NetworkErrorCode.UNAUTHORIZED_PEER,
        `Validator '${vId}' is not authorized to join the PDSChain validator federation`
      );
    }

    if (!nonce || !signature) {
      throw new NetworkError(NetworkErrorCode.CHALLENGE_FAILED, 'Missing challenge nonce or signature');
    }

    const info = getPublicParticipantInfo(vId);
    if (!info || !info.publicKey) {
      throw new NetworkError(
        NetworkErrorCode.UNAUTHORIZED_PEER,
        `No registered public key found for validator '${vId}'`
      );
    }

    try {
      const payloadStr = `PDSCHAIN_NET_AUTH:${vId}:${nonce}`;
      const dataBuffer = Buffer.from(payloadStr, 'utf8');
      const sigBuffer = Buffer.from(signature.replace(/^0x/, ''), 'hex');

      // Reconstruct Ed25519 public key from DER hex
      const spkiHeader = Buffer.from('302a300506032b6570032100', 'hex');
      const rawPub = Buffer.from(info.publicKey.replace(/^0x/, ''), 'hex');
      const derBuffer = rawPub.length === 44 ? rawPub : Buffer.concat([spkiHeader, rawPub]);

      const publicKeyObj = crypto.createPublicKey({
        key: derBuffer,
        format: 'der',
        type: 'spki'
      });

      const isVerified = crypto.verify(null, dataBuffer, publicKeyObj, sigBuffer);
      if (!isVerified) {
        throw new NetworkError(
          NetworkErrorCode.CHALLENGE_FAILED,
          `Cryptographic Ed25519 challenge signature verification failed for '${vId}'`
        );
      }

      return {
        valid: true,
        validatorId: vId,
        address: info.address,
        publicKey: info.publicKey
      };
    } catch (err) {
      if (err instanceof NetworkError) throw err;
      throw new NetworkError(
        NetworkErrorCode.CHALLENGE_FAILED,
        `Handshake signature verification error: ${err.message}`
      );
    }
  }
}

module.exports = PeerAuthenticator;
