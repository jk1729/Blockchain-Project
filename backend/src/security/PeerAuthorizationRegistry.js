/**
 * PDSChain PeerAuthorizationRegistry (Phase 12)
 * 
 * Manages validator authorization, peer whitelisting, certificate revocation (CRL),
 * and peer suspensions across the consortium.
 * 
 * Invariants:
 * - Revoked peers or certificates are immediately rejected with REVOKED_PEER.
 * - Suspended peers cannot participate in consensus or sync handshakes.
 * - In strict mode, only registered consortium validators are permitted to connect.
 * - Supports dynamic authorization updates without process reboot.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { NetworkErrorCode, NetworkError } = require('../network/NetworkErrors');

const PeerStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED'
};

class PeerAuthorizationRegistry extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {boolean} [options.strictMode=true] - Require explicit whitelist inclusion
   * @param {Array<object>} [options.initialPeers] - List of authorized peers
   */
  constructor(options = {}) {
    super();
    this.strictMode = options.strictMode !== false;
    // validatorId -> { validatorId, address, status, allowedFingerprints: Set<string>, revokedAt, reason }
    this.peers = new Map();
    // Set of revoked certificate fingerprints (SHA-256)
    this.revokedFingerprints = new Set();

    if (Array.isArray(options.initialPeers)) {
      for (const peer of options.initialPeers) {
        this.addPeer(peer.validatorId, peer);
      }
    }
  }

  /**
   * Add or register an authorized consortium validator
   * @param {string} validatorId 
   * @param {object} [info]
   */
  addPeer(validatorId, info = {}) {
    const id = String(validatorId).toUpperCase().trim();
    if (!id) return;

    const existing = this.peers.get(id) || {
      validatorId: id,
      address: info.address || null,
      status: PeerStatus.ACTIVE,
      allowedFingerprints: new Set(),
      addedAt: Date.now()
    };

    if (info.address) existing.address = info.address;
    if (info.fingerprint) existing.allowedFingerprints.add(info.fingerprint.toLowerCase().trim());
    if (Array.isArray(info.fingerprints)) {
      info.fingerprints.forEach(fp => existing.allowedFingerprints.add(fp.toLowerCase().trim()));
    }
    existing.status = PeerStatus.ACTIVE;

    this.peers.set(id, existing);
    this.emit('peer_added', { validatorId: id, status: PeerStatus.ACTIVE });
  }

  /**
   * Revoke a validator or compromise notice
   * @param {string} validatorId 
   * @param {string} [reason='Consortium decision']
   */
  revokePeer(validatorId, reason = 'Consortium decision') {
    const id = String(validatorId).toUpperCase().trim();
    const entry = this.peers.get(id) || {
      validatorId: id,
      allowedFingerprints: new Set()
    };

    entry.status = PeerStatus.REVOKED;
    entry.revokedAt = Date.now();
    entry.revocationReason = reason;

    this.peers.set(id, entry);
    logger.warn(`[PeerAuthorizationRegistry] Revoked peer '${id}': ${reason}`);
    this.emit('peer_revoked', { validatorId: id, reason });
  }

  /**
   * Revoke a specific certificate fingerprint (CRL)
   * @param {string} fingerprint 
   * @param {string} [reason='Certificate compromised or retired']
   */
  revokeCertificate(fingerprint, reason = 'Certificate retired') {
    if (!fingerprint) return;
    const fp = String(fingerprint).toLowerCase().trim();
    this.revokedFingerprints.add(fp);
    logger.warn(`[PeerAuthorizationRegistry] Revoked certificate fingerprint '${fp}': ${reason}`);
    this.emit('cert_revoked', { fingerprint: fp, reason });
  }

  /**
   * Temporarily suspend a peer
   * @param {string} validatorId 
   * @param {string} [reason='Under investigation']
   */
  suspendPeer(validatorId, reason = 'Under investigation') {
    const id = String(validatorId).toUpperCase().trim();
    const entry = this.peers.get(id);
    if (!entry) {
      throw new NetworkError(NetworkErrorCode.UNAUTHORIZED_PEER, `Cannot suspend unregistered peer '${id}'`);
    }

    entry.status = PeerStatus.SUSPENDED;
    entry.suspendedAt = Date.now();
    entry.suspensionReason = reason;

    logger.warn(`[PeerAuthorizationRegistry] Suspended peer '${id}': ${reason}`);
    this.emit('peer_suspended', { validatorId: id, reason });
  }

  /**
   * Re-activate a suspended peer
   * @param {string} validatorId 
   */
  unsuspendPeer(validatorId) {
    const id = String(validatorId).toUpperCase().trim();
    const entry = this.peers.get(id);
    if (!entry) return;

    if (entry.status === PeerStatus.SUSPENDED) {
      entry.status = PeerStatus.ACTIVE;
      delete entry.suspensionReason;
      delete entry.suspendedAt;
      logger.info(`[PeerAuthorizationRegistry] Unsuspended peer '${id}'`);
      this.emit('peer_unsuspended', { validatorId: id });
    }
  }

  /**
   * Verify peer authorization
   * @param {string} validatorId 
   * @param {string} [certFingerprint]
   * @returns {{ authorized: boolean, reason?: string }}
   */
  checkAuthorization(validatorId, certFingerprint = null) {
    const id = String(validatorId || '').toUpperCase().trim();

    // 1. Check certificate fingerprint revocation
    if (certFingerprint) {
      const fp = String(certFingerprint).toLowerCase().trim();
      if (this.revokedFingerprints.has(fp)) {
        return {
          authorized: false,
          code: NetworkErrorCode.REVOKED_CERTIFICATE,
          reason: `Certificate fingerprint '${fp}' is revoked`
        };
      }
    }

    const peer = this.peers.get(id);

    // 2. Check if registered
    if (!peer) {
      if (this.strictMode) {
        return {
          authorized: false,
          code: NetworkErrorCode.UNAUTHORIZED_PEER,
          reason: `Validator '${id}' is not in authorized consortium whitelist`
        };
      }
      return { authorized: true };
    }

    // 3. Check revocation
    if (peer.status === PeerStatus.REVOKED) {
      return {
        authorized: false,
        code: NetworkErrorCode.REVOKED_PEER,
        reason: `Validator '${id}' is permanently revoked (${peer.revocationReason || 'No reason specified'})`
      };
    }

    // 4. Check suspension
    if (peer.status === PeerStatus.SUSPENDED) {
      return {
        authorized: false,
        code: NetworkErrorCode.UNAUTHORIZED_PEER,
        reason: `Validator '${id}' is currently suspended (${peer.suspensionReason || 'Maintenance'})`
      };
    }

    // 5. Check allowed certificate pinned fingerprints if configured
    if (certFingerprint && peer.allowedFingerprints.size > 0) {
      const fp = String(certFingerprint).toLowerCase().trim();
      if (!peer.allowedFingerprints.has(fp)) {
        return {
          authorized: false,
          code: NetworkErrorCode.CERTIFICATE_MISMATCH,
          reason: `Certificate fingerprint '${fp}' does not match pinned fingerprints for '${id}'`
        };
      }
    }

    return { authorized: true };
  }

  /**
   * Assert authorization or throw NetworkError
   * @param {string} validatorId 
   * @param {string} [certFingerprint]
   */
  assertAuthorized(validatorId, certFingerprint = null) {
    const result = this.checkAuthorization(validatorId, certFingerprint);
    if (!result.authorized) {
      throw new NetworkError(result.code || NetworkErrorCode.UNAUTHORIZED_PEER, result.reason);
    }
  }

  /**
   * Health and registry status summary
   */
  getStatus() {
    return {
      strictMode: this.strictMode,
      totalRegistered: this.peers.size,
      activeCount: Array.from(this.peers.values()).filter(p => p.status === PeerStatus.ACTIVE).length,
      suspendedCount: Array.from(this.peers.values()).filter(p => p.status === PeerStatus.SUSPENDED).length,
      revokedCount: Array.from(this.peers.values()).filter(p => p.status === PeerStatus.REVOKED).length,
      revokedCertificatesCount: this.revokedFingerprints.size
    };
  }

  toJSON() {
    return this.getStatus();
  }
}

module.exports = {
  PeerAuthorizationRegistry,
  PeerStatus
};

