/**
 * PDSChain Protocol Version Negotiator & Upgrade Manager (Phase 11)
 * 
 * Manages protocol version compatibility, peer version negotiation,
 * and migration checks to ensure safe consensus operation.
 */

const CURRENT_PROTOCOL_VERSION = 1;
const MIN_SUPPORTED_PROTOCOL_VERSION = 1;
const MAX_SUPPORTED_PROTOCOL_VERSION = 2;

class VersionNegotiator {
  /**
   * Check if a peer's advertised protocol version is compatible with local node
   * @param {number} peerProtocolVersion 
   * @param {number} [localProtocolVersion=CURRENT_PROTOCOL_VERSION]
   * @returns {{ compatible: boolean, reason?: string }}
   */
  static isCompatible(peerProtocolVersion, localProtocolVersion = CURRENT_PROTOCOL_VERSION) {
    const pVer = parseInt(peerProtocolVersion, 10);
    if (isNaN(pVer) || pVer < 0) {
      return {
        compatible: false,
        reason: `Invalid peer protocol version: ${peerProtocolVersion}`
      };
    }

    if (pVer < MIN_SUPPORTED_PROTOCOL_VERSION) {
      return {
        compatible: false,
        reason: `Peer protocol version ${pVer} is obsolete. Minimum supported is ${MIN_SUPPORTED_PROTOCOL_VERSION}`
      };
    }

    if (pVer > MAX_SUPPORTED_PROTOCOL_VERSION) {
      return {
        compatible: false,
        reason: `Peer protocol version ${pVer} is ahead of local node. Maximum supported is ${MAX_SUPPORTED_PROTOCOL_VERSION}`
      };
    }

    return {
      compatible: true,
      negotiatedVersion: Math.min(pVer, localProtocolVersion)
    };
  }

  /**
   * Validate checkpoint and journal format version
   * @param {object} record 
   * @returns {boolean}
   */
  static isFormatCompatible(record) {
    if (!record || typeof record !== 'object') return false;
    // Phase 10 / 11 format version check
    if (record.version !== undefined) {
      const ver = parseInt(record.version, 10);
      return ver >= MIN_SUPPORTED_PROTOCOL_VERSION && ver <= MAX_SUPPORTED_PROTOCOL_VERSION;
    }
    return true; // Default legacy format is accepted as version 1
  }
}

module.exports = {
  CURRENT_PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  MAX_SUPPORTED_PROTOCOL_VERSION,
  VersionNegotiator
};
