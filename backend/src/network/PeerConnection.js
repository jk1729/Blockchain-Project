const EventEmitter = require('events');
const { StreamDecoder, MessageCodec } = require('./MessageCodec');
const { MessageEnvelope, MessageType } = require('./MessageEnvelope');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');
const logger = require('../utils/logger');

const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  AUTHENTICATING: 'AUTHENTICATING',
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
  CLOSING: 'CLOSING'
};

class PeerConnection extends EventEmitter {
  /**
   * @param {object} params
   * @param {net.Socket|tls.TLSSocket} params.socket
   * @param {boolean} [params.isInbound=false]
   * @param {string} [params.expectedValidatorId]
   * @param {NetworkConfig} params.config
   */
  constructor(params = {}) {
    super();
    this.socket = params.socket;
    this.isInbound = Boolean(params.isInbound);
    this.expectedValidatorId = params.expectedValidatorId ? String(params.expectedValidatorId).toUpperCase() : null;
    this.config = params.config;

    this.state = ConnectionState.CONNECTING;
    this.peerValidatorId = this.expectedValidatorId;
    this.peerAddress = null;
    this.peerPublicKey = null;

    // TLS / mTLS transport metadata
    this.isEncrypted = false;
    this.peerCertificate = null;
    this.peerCertificateFingerprint = null;
    this.peerCertificateSubject = null;
    this.tlsProtocol = null;
    this.tlsCipher = null;

    this.lastSeen = Date.now();
    this.lastPingSent = 0;
    this.latencyMs = 0;
    this.queuedCount = 0;

    this.decoder = new StreamDecoder({ maxFrameSize: this.config.maxFrameSizeBytes });
    this.heartbeatTimer = null;
    this.inactivityTimer = null;

    this._setupSocket();
  }

  _setupSocket() {
    this.state = ConnectionState.AUTHENTICATING;
    this._extractTLSInfo();

    this.socket.on('data', (chunk) => {
      this.lastSeen = Date.now();
      if (this.state === ConnectionState.DEGRADED) {
        this.state = ConnectionState.CONNECTED;
      }
      this.decoder.push(chunk);
    });

    this.decoder.on('message', (envelope) => {
      this.emit('message', envelope, this);
    });

    this.decoder.on('error', (err) => {
      this.emit('framing_error', err, this);
      this.close(`Framing error: ${err.message}`);
    });

    this.socket.on('error', (err) => {
      this.emit('socket_error', err, this);
      this.close(`Socket error: ${err.message}`);
    });

    this.socket.on('close', () => {
      this._handleClose();
    });

    // Start inactivity watchdog timer
    this.inactivityTimer = setInterval(() => {
      this._checkInactivity();
    }, Math.max(1000, Math.floor(this.config.peerInactivityTimeoutMs / 2)));
  }

  _extractTLSInfo() {
    if (this.socket && (this.socket.encrypted || typeof this.socket.getPeerCertificate === 'function')) {
      try {
        this.isEncrypted = Boolean(this.socket.encrypted);
        if (typeof this.socket.getPeerCertificate === 'function') {
          const rawPeerCert = this.socket.getPeerCertificate(true);
          if (rawPeerCert && Object.keys(rawPeerCert).length > 0) {
            this.peerCertificate = rawPeerCert;
            this.peerCertificateFingerprint = rawPeerCert.fingerprint256 || rawPeerCert.fingerprint || null;
            this.peerCertificateSubject = rawPeerCert.subject ? (rawPeerCert.subject.CN || null) : null;
          }
        }
        this.tlsProtocol = typeof this.socket.getProtocol === 'function' ? this.socket.getProtocol() : null;
        this.tlsCipher = typeof this.socket.getCipher === 'function' ? this.socket.getCipher() : null;
      } catch (e) {
        // ignore extraction errors
      }
    }
  }

  markAuthenticated(validatorId, address, publicKey, tlsMetadata = {}) {
    this._extractTLSInfo();
    this.peerValidatorId = String(validatorId).toUpperCase().trim();
    this.peerAddress = address;
    this.peerPublicKey = publicKey;
    if (tlsMetadata.peerCertificate) this.peerCertificate = tlsMetadata.peerCertificate;
    if (tlsMetadata.peerCertificateFingerprint) this.peerCertificateFingerprint = tlsMetadata.peerCertificateFingerprint;
    this.state = ConnectionState.CONNECTED;
    this.lastSeen = Date.now();

    // Start heartbeat timer
    this._startHeartbeat();
    this.emit('authenticated', this);
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (this.state === ConnectionState.CONNECTED || this.state === ConnectionState.DEGRADED) {
        this.sendPing();
      }
    }, this.config.heartbeatIntervalMs);
  }

  sendPing() {
    try {
      this.lastPingSent = Date.now();
      const pingEnvelope = new MessageEnvelope({
        version: this.config.protocolVersion,
        networkId: this.config.networkId,
        chainId: this.config.chainId,
        type: MessageType.HEARTBEAT,
        senderId: this.config.validatorId,
        payload: { action: 'PING', timestamp: this.lastPingSent }
      });
      this.send(pingEnvelope);
    } catch (err) {
      // Ignored if socket is closing
    }
  }

  handlePong(envelope) {
    if (this.lastPingSent > 0) {
      this.latencyMs = Math.max(0, Date.now() - this.lastPingSent);
    }
    this.lastSeen = Date.now();
  }

  _checkInactivity() {
    const elapsed = Date.now() - this.lastSeen;
    if (elapsed > this.config.peerInactivityTimeoutMs) {
      if (this.state === ConnectionState.CONNECTED) {
        this.state = ConnectionState.DEGRADED;
        this.emit('degraded', this);
      } else if (elapsed > this.config.peerInactivityTimeoutMs * 2) {
        this.close(`Peer inactive for ${elapsed}ms`);
      }
    }
  }

  /**
   * Send a MessageEnvelope over the wire
   * @param {MessageEnvelope} envelope 
   */
  send(envelope) {
    if (this.state === ConnectionState.DISCONNECTED || this.state === ConnectionState.CLOSING) {
      throw new NetworkError(NetworkErrorCode.PEER_DISCONNECTED, `Cannot send message to disconnected peer '${this.peerValidatorId}'`);
    }

    // Check backpressure queue limit
    if (this.socket.bufferSize > this.config.maxQueueSize * 1024) {
      throw new NetworkError(NetworkErrorCode.QUEUE_OVERFLOW, `Outbound buffer overflow for peer '${this.peerValidatorId}'`);
    }

    const frame = MessageCodec.encode(envelope, this.config.maxFrameSizeBytes);
    this.socket.write(frame);
    this.emit('sent', envelope);
  }

  close(reason = 'Normal closure') {
    if (this.state === ConnectionState.CLOSING || this.state === ConnectionState.DISCONNECTED) {
      return;
    }

    this.state = ConnectionState.CLOSING;
    this._cleanupTimers();

    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.end();
        this.socket.destroy();
      } catch (e) {}
    }

    this._handleClose(reason);
  }

  _cleanupTimers() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  _handleClose(reason = '') {
    this.state = ConnectionState.DISCONNECTED;
    this._cleanupTimers();
    this.emit('close', reason, this);
  }

  isConnected() {
    return this.state === ConnectionState.CONNECTED;
  }

  toJSON() {
    return {
      validatorId: this.peerValidatorId,
      state: this.state,
      isInbound: this.isInbound,
      peerAddress: this.peerAddress,
      latencyMs: this.latencyMs,
      lastSeen: this.lastSeen,
      uptimeSeconds: Math.floor((Date.now() - (this.lastSeen || Date.now())) / 1000),
      isEncrypted: Boolean(this.isEncrypted || (this.socket && this.socket.encrypted)),
      tlsProtocol: this.tlsProtocol || null,
      peerCertificateFingerprint: this.peerCertificateFingerprint || null
    };
  }
}

module.exports = {
  ConnectionState,
  PeerConnection
};

