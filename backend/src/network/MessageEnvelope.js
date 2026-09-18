const crypto = require('crypto');
const { serializeCanonical, hashCanonical } = require('../blockchain/serialization');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');

const MessageType = {
  HANDSHAKE: 'HANDSHAKE',
  HANDSHAKE_ACK: 'HANDSHAKE_ACK',
  HANDSHAKE_COMPLETE: 'HANDSHAKE_COMPLETE',
  HEARTBEAT: 'HEARTBEAT',
  PROPOSAL: 'PROPOSAL',
  VOTE: 'VOTE',
  CERTIFICATE: 'CERTIFICATE',
  ROUND_CHANGE: 'ROUND_CHANGE',
  SYNC_REQUEST: 'SYNC_REQUEST',
  SYNC_RESPONSE: 'SYNC_RESPONSE',
  HEIGHT_DISCOVERY_REQUEST: 'HEIGHT_DISCOVERY_REQUEST',
  HEIGHT_DISCOVERY_RESPONSE: 'HEIGHT_DISCOVERY_RESPONSE',
  CHECKPOINT_REQUEST: 'CHECKPOINT_REQUEST',
  CHECKPOINT_RESPONSE: 'CHECKPOINT_RESPONSE',
  ANCESTOR_REQUEST: 'ANCESTOR_REQUEST',
  ANCESTOR_RESPONSE: 'ANCESTOR_RESPONSE',
  ERROR: 'ERROR'
};

class MessageEnvelope {
  /**
   * @param {object} params
   */
  constructor(params = {}) {
    this.version = parseInt(params.version !== undefined ? params.version : 1, 10);
    this.networkId = String(params.networkId || 'pdschain-mainnet').trim();
    this.chainId = parseInt(params.chainId !== undefined ? params.chainId : 1729, 10);
    this.type = String(params.type || '').toUpperCase().trim();
    this.senderId = String(params.senderId || '').toUpperCase().trim();
    this.timestamp = params.timestamp || new Date().toISOString();
    this.correlationId = params.correlationId ? String(params.correlationId) : null;
    this.payload = params.payload && typeof params.payload === 'object' ? params.payload : {};
    this.signature = params.signature ? String(params.signature) : null;
    this.messageId = params.messageId || this.calculateMessageId();
  }

  /**
   * Calculate deterministic messageId from canonical serialization
   * @returns {string}
   */
  calculateMessageId() {
    const canonicalStr = serializeCanonical({
      version: this.version,
      networkId: this.networkId,
      chainId: this.chainId,
      type: this.type,
      senderId: this.senderId,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      payload: this.payload
    });
    const hash = crypto.createHash('sha256').update(canonicalStr).digest('hex');
    return `MSG-${hash.substring(0, 32)}`;
  }

  isTampered() {
    return this.calculateMessageId() !== this.messageId;
  }

  /**
   * Validate envelope structure and constraints
   * @param {object} [expectedContext] - { networkId, chainId, protocolVersion }
   * @returns {boolean}
   */
  validate(expectedContext = {}) {
    if (!this.type || !MessageType[this.type]) {
      throw new NetworkError(NetworkErrorCode.UNKNOWN_MESSAGE_TYPE, `Unknown message type: '${this.type}'`);
    }

    if (!this.senderId) {
      throw new NetworkError(NetworkErrorCode.MALFORMED_ENVELOPE, 'Envelope missing senderId');
    }

    if (!this.messageId) {
      throw new NetworkError(NetworkErrorCode.MALFORMED_ENVELOPE, 'Envelope missing messageId');
    }

    if (expectedContext.protocolVersion && this.version !== expectedContext.protocolVersion) {
      throw new NetworkError(
        NetworkErrorCode.PROTOCOL_VERSION_MISMATCH,
        `Protocol version mismatch: got ${this.version}, expected ${expectedContext.protocolVersion}`
      );
    }

    if (expectedContext.networkId && this.networkId !== expectedContext.networkId) {
      throw new NetworkError(
        NetworkErrorCode.NETWORK_ID_MISMATCH,
        `Network ID mismatch: got '${this.networkId}', expected '${expectedContext.networkId}'`
      );
    }

    if (expectedContext.chainId && this.chainId !== expectedContext.chainId) {
      throw new NetworkError(
        NetworkErrorCode.CHAIN_ID_MISMATCH,
        `Chain ID mismatch: got ${this.chainId}, expected ${expectedContext.chainId}`
      );
    }

    return true;
  }

  toJSON() {
    return {
      version: this.version,
      networkId: this.networkId,
      chainId: this.chainId,
      type: this.type,
      senderId: this.senderId,
      messageId: this.messageId,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
      payload: this.payload,
      signature: this.signature
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') {
      throw new NetworkError(NetworkErrorCode.MALFORMED_ENVELOPE, 'Message data must be a JSON object');
    }
    return new MessageEnvelope(data);
  }
}

module.exports = {
  MessageType,
  MessageEnvelope
};
