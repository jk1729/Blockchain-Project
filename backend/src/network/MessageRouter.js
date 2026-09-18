const EventEmitter = require('events');
const { MessageType } = require('./MessageEnvelope');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');
const logger = require('../utils/logger');

class MessageRouter extends EventEmitter {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {PeerManager} params.peerManager
   * @param {NetworkMetrics} [params.metrics]
   * @param {number} [params.messageTtlMs=60000]
   */
  constructor(params = {}) {
    super();
    if (!params.config) throw new Error('MessageRouter requires NetworkConfig');
    if (!params.peerManager) throw new Error('MessageRouter requires PeerManager');

    this.config = params.config;
    this.peerManager = params.peerManager;
    this.metrics = params.metrics || this.peerManager.metrics;
    this.messageTtlMs = params.messageTtlMs || 60000;

    // Cache of seen messageIds for duplicate suppression: messageId -> seenTimestamp
    this.seenMessageIds = new Map();

    // Handlers registered per MessageType: Map<string, Function[]>
    this.handlers = new Map();

    // Pending correlation requests (e.g. for SYNC_REQUEST/SYNC_RESPONSE):
    // correlationId -> { resolve, reject, timer }
    this.pendingCorrelations = new Map();

    // Bind to PeerManager messages
    this._onPeerMessage = (envelope, peerConn) => this.route(envelope, peerConn);
    this.peerManager.on('message', this._onPeerMessage);

    // Periodic cleanup of seen message cache
    this.cleanupTimer = setInterval(() => {
      this._cleanupSeenMessages();
    }, 15000);
  }

  /**
   * Register a handler callback for a specific MessageType
   * @param {string} messageType 
   * @param {Function} handlerFn - async (envelope, peerConn) => void
   */
  registerHandler(messageType, handlerFn) {
    if (!this.handlers.has(messageType)) {
      this.handlers.set(messageType, []);
    }
    this.handlers.get(messageType).push(handlerFn);
  }

  /**
   * Route an incoming MessageEnvelope
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async route(envelope, peerConn) {
    try {
      // 1. Basic validation against local network parameters
      envelope.validate({
        protocolVersion: this.config.protocolVersion,
        networkId: this.config.networkId,
        chainId: this.config.chainId
      });

      // 2. Duplicate detection
      const msgId = envelope.messageId;
      if (this.seenMessageIds.has(msgId)) {
        if (this.metrics) this.metrics.incrementDuplicate();
        logger.debug(`[MessageRouter] Suppressing duplicate message: ${msgId} (${envelope.type})`);
        return;
      }
      this.seenMessageIds.set(msgId, Date.now());

      // 3. Check for correlated response
      if (envelope.correlationId && this.pendingCorrelations.has(envelope.correlationId)) {
        const pending = this.pendingCorrelations.get(envelope.correlationId);
        this.pendingCorrelations.delete(envelope.correlationId);
        clearTimeout(pending.timer);
        pending.resolve(envelope);
      }

      // 4. Dispatch to registered type handlers
      const typeHandlers = this.handlers.get(envelope.type);
      if (typeHandlers && typeHandlers.length > 0) {
        for (const handler of typeHandlers) {
          try {
            await handler(envelope, peerConn);
          } catch (handlerErr) {
            logger.warn(`[MessageRouter] Handler error for ${envelope.type} from ${envelope.senderId}: ${handlerErr.message}`);
          }
        }
      }

      // 5. Emit generic routed event
      this.emit('routed', envelope, peerConn);
    } catch (err) {
      if (this.metrics) this.metrics.incrementRejected(err.code || 'ROUTING_ERROR');
      logger.warn(`[MessageRouter] Routing failed for message from ${peerConn.peerValidatorId || 'unauth'}: ${err.message}`);
    }
  }

  /**
   * Send a request and wait for a correlated response
   * @param {string} targetValidatorId 
   * @param {MessageEnvelope} requestEnvelope 
   * @param {number} [timeoutMs=5000]
   * @returns {Promise<MessageEnvelope>}
   */
  async requestResponse(targetValidatorId, requestEnvelope, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const msgId = requestEnvelope.messageId;

      const timer = setTimeout(() => {
        if (this.pendingCorrelations.has(msgId)) {
          this.pendingCorrelations.delete(msgId);
          reject(new NetworkError(NetworkErrorCode.CONNECTION_TIMEOUT, `Timed out waiting for response to ${msgId} from ${targetValidatorId}`));
        }
      }, timeoutMs);

      this.pendingCorrelations.set(msgId, { resolve, reject, timer });

      try {
        this.peerManager.sendTo(targetValidatorId, requestEnvelope);
      } catch (err) {
        clearTimeout(timer);
        this.pendingCorrelations.delete(msgId);
        reject(err);
      }
    });
  }

  _cleanupSeenMessages() {
    const now = Date.now();
    for (const [id, timestamp] of this.seenMessageIds.entries()) {
      if (now - timestamp > this.messageTtlMs) {
        this.seenMessageIds.delete(id);
      }
    }
  }

  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const pending of this.pendingCorrelations.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MessageRouter stopped'));
    }
    this.pendingCorrelations.clear();
    this.peerManager.removeListener('message', this._onPeerMessage);
  }
}

module.exports = MessageRouter;
