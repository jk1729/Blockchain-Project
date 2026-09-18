/**
 * PDSChain Discovery Handler (Phase 10)
 * 
 * Handles peer queries for finalized ledger heights, latest block hashes,
 * common-ancestor hashes, and checkpoints.
 */

const { MessageEnvelope, MessageType } = require('../MessageEnvelope');
const logger = require('../../utils/logger');

class DiscoveryHandler {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {Blockchain} params.blockchain
   * @param {CheckpointManager} [params.checkpointManager]
   */
  constructor(params = {}) {
    this.config = params.config;
    this.blockchain = params.blockchain;
    this.checkpointManager = params.checkpointManager || null;
  }

  /**
   * Handle incoming HEIGHT_DISCOVERY_REQUEST
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handleHeightDiscoveryRequest(envelope, peerConn) {
    const latest = this.blockchain ? this.blockchain.getLatestBlock() : null;
    const cp = this.checkpointManager ? this.checkpointManager.getLatestCheckpoint() : null;

    const responseEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.HEIGHT_DISCOVERY_RESPONSE,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        finalizedHeight: latest ? latest.blockNumber : 0,
        latestBlockHash: latest ? latest.blockHash : '0'.repeat(64),
        stateRoot: latest ? latest.stateRoot : '',
        checkpointHash: cp ? cp.checkpointHash : '',
        timestamp: new Date().toISOString()
      }
    });

    peerConn.send(responseEnvelope);
    logger.debug(`[DiscoveryHandler] Responded to height discovery from ${envelope.senderId}: height #${responseEnvelope.payload.finalizedHeight}`);
  }

  /**
   * Handle incoming ANCESTOR_REQUEST (for locating common finalized ancestor)
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handleAncestorRequest(envelope, peerConn) {
    const payload = envelope.payload || {};
    const heights = Array.isArray(payload.heights) ? payload.heights : [];
    const results = [];

    if (this.blockchain) {
      for (const h of heights) {
        const block = this.blockchain.getBlockByNumber(h);
        if (block) {
          results.push({
            height: block.blockNumber,
            blockHash: block.blockHash,
            previousHash: block.previousHash
          });
        }
      }
    }

    const responseEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.ANCESTOR_RESPONSE,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        results,
        count: results.length
      }
    });

    peerConn.send(responseEnvelope);
    logger.debug(`[DiscoveryHandler] Responded to ancestor query from ${envelope.senderId} with ${results.length} hashes`);
  }

  /**
   * Handle incoming CHECKPOINT_REQUEST
   * @param {MessageEnvelope} envelope 
   * @param {PeerConnection} peerConn 
   */
  async handleCheckpointRequest(envelope, peerConn) {
    const cp = this.checkpointManager ? this.checkpointManager.getLatestCheckpoint() : null;

    const responseEnvelope = new MessageEnvelope({
      version: this.config.protocolVersion,
      networkId: this.config.networkId,
      chainId: this.config.chainId,
      type: MessageType.CHECKPOINT_RESPONSE,
      senderId: this.config.validatorId,
      correlationId: envelope.messageId,
      payload: {
        checkpoint: cp ? cp.toJSON() : null
      }
    });

    peerConn.send(responseEnvelope);
  }
}

module.exports = DiscoveryHandler;

