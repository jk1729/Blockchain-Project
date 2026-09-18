const EventEmitter = require('events');
const { TLSTransport } = require('./TLSTransport');
const { PeerConnection, ConnectionState } = require('./PeerConnection');
const { MessageType } = require('./MessageEnvelope');
const HandshakeHandler = require('./handlers/HandshakeHandler');
const HeartbeatHandler = require('./handlers/HeartbeatHandler');
const NetworkMetrics = require('./NetworkMetrics');
const { NetworkError, NetworkErrorCode } = require('./NetworkErrors');
const logger = require('../utils/logger');

class PeerManager extends EventEmitter {
  /**
   * @param {object} params
   * @param {NetworkConfig} params.config
   * @param {PeerAuthenticator} params.authenticator
   * @param {NetworkMetrics} [params.metrics]
   * @param {CertificateManager} [params.certificateManager]
   * @param {PeerAuthorizationRegistry} [params.peerAuthorizationRegistry]
   */
  constructor(params = {}) {
    super();
    if (!params.config) throw new Error('PeerManager requires NetworkConfig');
    if (!params.authenticator) throw new Error('PeerManager requires PeerAuthenticator');

    this.config = params.config;
    this.authenticator = params.authenticator;
    this.metrics = params.metrics || new NetworkMetrics();
    this.certificateManager = params.certificateManager || null;
    this.peerAuthorizationRegistry = params.peerAuthorizationRegistry || null;

    this.handshakeHandler = new HandshakeHandler(this.config, this.authenticator, {
      certificateManager: this.certificateManager,
      peerAuthorizationRegistry: this.peerAuthorizationRegistry
    });
    this.heartbeatHandler = new HeartbeatHandler(this.config);

    this.server = null;
    this.isRunning = false;

    // Authenticated active peers: validatorId -> PeerConnection
    this.peers = new Map();
    // Inbound connections undergoing handshake: Set<PeerConnection>
    this.inboundConnections = new Set();
    // Reconnect management: validatorId -> Timeout
    this.reconnectTimers = new Map();
    // Exponential backoff state: validatorId -> currentBackoffMs
    this.reconnectBackoffs = new Map();
  }

  /**
   * Start listening for inbound connections and connect to configured peers
   */
  async start() {
    if (this.isRunning) return;
    this.isRunning = true;

    // 1. Start TLS/TCP Server
    this.server = await TLSTransport.createServer(
      this.config.listenPort,
      this.config.listenHost,
      {
        tls: this.config.tls,
        tlsOptions: this.config.tlsOptions,
        onConnection: (socket) => this._handleInboundSocket(socket)
      }
    );

    logger.info(`[PeerManager] Listening on ${this.config.listenHost}:${this.config.listenPort} for validator ${this.config.validatorId} (TLS: ${this.config.tls})`);

    // 2. Connect to configured peers
    this._connectToAllPeers();
  }

  /**
   * Graceful shutdown of PeerManager
   */
  async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;

    // Clear all reconnect timers
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.reconnectBackoffs.clear();

    // Close all active peer connections
    for (const peer of this.peers.values()) {
      try {
        peer.close('PeerManager stopping');
      } catch (err) {
        // ignore
      }
    }
    this.peers.clear();

    // Close pending inbound connections
    for (const conn of this.inboundConnections) {
      try {
        conn.close('PeerManager stopping');
      } catch (err) {
        // ignore
      }
    }
    this.inboundConnections.clear();

    // Close server
    if (this.server) {
      await TLSTransport.closeServer(this.server);
      this.server = null;
    }

    this.metrics.setActiveConnections(0);
    logger.info(`[PeerManager] Stopped validator ${this.config.validatorId}`);
  }

  _connectToAllPeers() {
    for (const peerCfg of this.config.peers) {
      if (peerCfg.validatorId === this.config.validatorId) {
        continue; // Don't connect to self
      }
      this._scheduleConnect(peerCfg, 0);
    }
  }

  _scheduleConnect(peerCfg, delayMs = 0) {
    if (!this.isRunning) return;
    const peerId = peerCfg.validatorId;

    if (this.reconnectTimers.has(peerId)) {
      clearTimeout(this.reconnectTimers.get(peerId));
      this.reconnectTimers.delete(peerId);
    }

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peerId);
      this._connectToPeer(peerCfg);
    }, delayMs);

    this.reconnectTimers.set(peerId, timer);
  }

  async _connectToPeer(peerCfg) {
    if (!this.isRunning) return;
    const peerId = peerCfg.validatorId;

    // If already connected, skip
    const existing = this.peers.get(peerId);
    if (existing && existing.isConnected()) {
      return;
    }

    // Check max peer limit
    if (this.peers.size >= this.config.maxPeers) {
      logger.warn(`[PeerManager] Max peers limit reached (${this.config.maxPeers}). Cannot connect to ${peerId}`);
      return;
    }

    this.metrics.incrementReconnect();

    try {
      const socket = await TLSTransport.connect(
        peerCfg.port,
        peerCfg.host,
        {
          tls: this.config.tls,
          tlsOptions: this.config.tlsOptions,
          timeoutMs: this.config.connectionTimeoutMs
        }
      );

      const peerConn = new PeerConnection({
        socket,
        isInbound: false,
        expectedValidatorId: peerId,
        config: this.config
      });

      this._setupConnectionHandlers(peerConn, peerCfg);

      // Begin mutual handshake
      this.handshakeHandler.initiateHandshake(peerConn);
    } catch (err) {
      logger.debug(`[PeerManager] Failed to connect to ${peerId} (${peerCfg.host}:${peerCfg.port}): ${err.message}`);
      this._handleOutboundFailure(peerCfg);
    }
  }

  _handleOutboundFailure(peerCfg) {
    if (!this.isRunning) return;
    const peerId = peerCfg.validatorId;

    const currentBackoff = this.reconnectBackoffs.get(peerId) || this.config.reconnectBaseIntervalMs;
    const nextBackoff = Math.min(currentBackoff * 2, this.config.reconnectMaxIntervalMs);
    this.reconnectBackoffs.set(peerId, nextBackoff);

    this._scheduleConnect(peerCfg, currentBackoff);
  }

  _handleInboundSocket(socket) {
    if (!this.isRunning) {
      socket.destroy();
      return;
    }

    if (this.peers.size + this.inboundConnections.size >= this.config.maxPeers * 2) {
      logger.warn(`[PeerManager] Rejecting inbound connection: maximum connection capacity reached`);
      socket.destroy();
      return;
    }

    const peerConn = new PeerConnection({
      socket,
      isInbound: true,
      config: this.config
    });

    this.inboundConnections.add(peerConn);
    this._setupConnectionHandlers(peerConn);
  }

  _setupConnectionHandlers(peerConn, peerCfg = null) {
    peerConn.on('authenticated', (conn) => {
      this._handlePeerAuthenticated(conn);
    });

    peerConn.on('message', (envelope, conn) => {
      this._handleMessage(envelope, conn);
    });

    peerConn.on('framing_error', (err, conn) => {
      this.metrics.incrementFramingError();
      logger.warn(`[PeerManager] Framing error from ${conn.peerValidatorId || 'unauth'}: ${err.message}`);
    });

    peerConn.on('close', (reason, conn) => {
      this._handleConnectionClose(conn, peerCfg, reason);
    });
  }

  _handlePeerAuthenticated(peerConn) {
    const peerId = peerConn.peerValidatorId;
    this.inboundConnections.delete(peerConn);

    if (peerId === this.config.validatorId) {
      logger.warn(`[PeerManager] Detected loopback self-connection. Closing.`);
      peerConn.close('Self-connection rejected');
      return;
    }

    // Collision deduplication
    if (this.peers.has(peerId)) {
      const existing = this.peers.get(peerId);
      if (existing && existing.isConnected()) {
        logger.info(`[PeerManager] Duplicate connection to ${peerId} detected. Resolving.`);
        // Deterministic collision resolution: Keep the outbound connection of the validator with the lexicographically smaller ID
        const keepOutbound = this.config.validatorId < peerId;
        const currentIsPreferred = keepOutbound ? !peerConn.isInbound : peerConn.isInbound;

        if (currentIsPreferred) {
          existing.close('Superseded by preferred connection');
          this.peers.set(peerId, peerConn);
        } else {
          peerConn.close('Duplicate connection closed in favor of existing');
          return;
        }
      } else {
        this.peers.set(peerId, peerConn);
      }
    } else {
      this.peers.set(peerId, peerConn);
    }

    // Reset backoff upon successful authentication
    this.reconnectBackoffs.delete(peerId);
    this.metrics.setActiveConnections(this.peers.size);

    logger.info(`[PeerManager] Peer authenticated: ${peerId} (${peerConn.peerAddress}) [Total active: ${this.peers.size}]`);
    this.emit('peer_connected', peerConn);
  }

  _handleConnectionClose(conn, peerCfg, reason) {
    this.inboundConnections.delete(conn);
    const peerId = conn.peerValidatorId;

    if (peerId && this.peers.get(peerId) === conn) {
      this.peers.delete(peerId);
      this.metrics.setActiveConnections(this.peers.size);
      logger.info(`[PeerManager] Peer disconnected: ${peerId} (${reason}) [Total active: ${this.peers.size}]`);
      this.emit('peer_disconnected', peerId, reason);
    }

    // If this was an outbound connection or peer is in topology, schedule reconnect
    const targetPeerCfg = peerCfg || (peerId ? this.config.peers.find(p => p.validatorId === peerId) : null);
    if (targetPeerCfg && this.isRunning && targetPeerCfg.validatorId !== this.config.validatorId) {
      this._handleOutboundFailure(targetPeerCfg);
    }
  }

  _handleMessage(envelope, peerConn) {
    try {
      this.metrics.incrementReceived(envelope.type);

      // 1. Handshake handling
      if (envelope.type === MessageType.HANDSHAKE) {
        this.handshakeHandler.handleHandshake(envelope, peerConn);
        return;
      }
      if (envelope.type === MessageType.HANDSHAKE_ACK) {
        this.handshakeHandler.handleHandshakeAck(envelope, peerConn);
        return;
      }
      if (envelope.type === MessageType.HANDSHAKE_COMPLETE) {
        this.handshakeHandler.handleHandshakeComplete(envelope, peerConn);
        return;
      }

      // 2. Heartbeat handling
      if (envelope.type === MessageType.HEARTBEAT) {
        this.heartbeatHandler.handleHeartbeat(envelope, peerConn);
        if (peerConn.peerValidatorId && peerConn.latencyMs > 0) {
          this.metrics.recordLatency(peerConn.peerValidatorId, peerConn.latencyMs);
        }
        return;
      }

      // 3. For any other message, verify peer is authenticated
      if (!peerConn.isConnected() || !peerConn.peerValidatorId) {
        this.metrics.incrementRejected(NetworkErrorCode.UNAUTHORIZED_PEER);
        throw new NetworkError(NetworkErrorCode.UNAUTHORIZED_PEER, `Received ${envelope.type} from unauthenticated peer`);
      }

      // Emit message for higher-layer routing
      this.emit('message', envelope, peerConn);
    } catch (err) {
      logger.warn(`[PeerManager] Error handling message from ${peerConn.peerValidatorId || 'unknown'}: ${err.message}`);
      this.metrics.incrementRejected(err.code || 'MESSAGE_PROCESSING_ERROR');
    }
  }

  /**
   * Send envelope to specific validator
   * @param {string} validatorId 
   * @param {MessageEnvelope} envelope 
   */
  sendTo(validatorId, envelope) {
    const targetId = String(validatorId).toUpperCase().trim();
    const peerConn = this.peers.get(targetId);

    if (!peerConn || !peerConn.isConnected()) {
      throw new NetworkError(NetworkErrorCode.PEER_DISCONNECTED, `Cannot send to ${targetId}: peer not connected`);
    }

    peerConn.send(envelope);
    this.metrics.incrementSent(envelope.type);
    return true;
  }

  /**
   * Broadcast envelope to all connected peers
   * @param {MessageEnvelope} envelope 
   * @param {string} [excludeValidatorId] 
   * @returns {number} count of peers sent to
   */
  broadcast(envelope, excludeValidatorId = null) {
    const excludeId = excludeValidatorId ? String(excludeValidatorId).toUpperCase().trim() : null;
    let sentCount = 0;

    for (const [peerId, peerConn] of this.peers.entries()) {
      if (excludeId && peerId === excludeId) {
        continue;
      }

      if (peerConn.isConnected()) {
        try {
          peerConn.send(envelope);
          sentCount++;
        } catch (err) {
          logger.debug(`[PeerManager] Failed to send broadcast to ${peerId}: ${err.message}`);
        }
      }
    }

    this.metrics.incrementSent(envelope.type);
    return sentCount;
  }

  getConnectedPeers() {
    const result = [];
    for (const peer of this.peers.values()) {
      result.push(peer.toJSON());
    }
    return result;
  }

  getPeer(validatorId) {
    return this.peers.get(String(validatorId).toUpperCase().trim()) || null;
  }

  isConnectedTo(validatorId) {
    const peer = this.getPeer(validatorId);
    return peer ? peer.isConnected() : false;
  }

  getStatus() {
    return {
      validatorId: this.config.validatorId,
      isRunning: this.isRunning,
      listenPort: this.config.listenPort,
      tlsEnabled: this.config.tls,
      activePeerCount: this.peers.size,
      connectedPeers: this.getConnectedPeers(),
      metrics: this.metrics.getSnapshot()
    };
  }
}

module.exports = PeerManager;

