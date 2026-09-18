const { MessageEnvelope, MessageType } = require('../MessageEnvelope');
const logger = require('../../utils/logger');

class HeartbeatHandler {
  /**
   * @param {NetworkConfig} config
   */
  constructor(config) {
    this.config = config;
  }

  /**
   * Handle incoming HEARTBEAT message (PING or PONG)
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConnection 
   */
  handleHeartbeat(envelope, peerConnection) {
    const payload = envelope.payload || {};
    const action = payload.action;

    if (action === 'PING') {
      // Reply with PONG
      const pongEnvelope = new MessageEnvelope({
        version: this.config.protocolVersion,
        networkId: this.config.networkId,
        chainId: this.config.chainId,
        type: MessageType.HEARTBEAT,
        senderId: this.config.validatorId,
        correlationId: envelope.messageId,
        payload: {
          action: 'PONG',
          timestamp: payload.timestamp,
          receivedAt: Date.now()
        }
      });

      try {
        peerConnection.send(pongEnvelope);
      } catch (err) {
        logger.debug(`[HeartbeatHandler] Failed to send PONG to ${envelope.senderId}: ${err.message}`);
      }
    } else if (action === 'PONG') {
      peerConnection.handlePong(envelope);
    }
  }
}

module.exports = HeartbeatHandler;

