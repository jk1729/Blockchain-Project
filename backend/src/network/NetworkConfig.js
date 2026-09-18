const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');
const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');

class NetworkConfig {
  /**
   * @param {object} options
   */
  constructor(options = {}) {
    this.networkId = String(options.networkId || process.env.NETWORK_ID || 'pdschain-mainnet').trim();
    this.chainId = parseInt(options.chainId !== undefined ? options.chainId : (process.env.CHAIN_ID || 1729), 10);
    this.protocolVersion = parseInt(options.protocolVersion !== undefined ? options.protocolVersion : (process.env.PROTOCOL_VERSION || 1), 10);
    this.validatorId = String(options.validatorId || process.env.VALIDATOR_ID || '').trim().toUpperCase();
    this.listenHost = String(options.listenHost || process.env.P2P_HOST || '127.0.0.1').trim();
    this.listenPort = parseInt(options.listenPort !== undefined ? options.listenPort : (process.env.P2P_PORT || 0), 10);

    // Peers list: array of { validatorId, host, port }
    this.peers = Array.isArray(options.peers) ? options.peers.map(p => ({
      validatorId: String(p.validatorId || '').trim().toUpperCase(),
      host: String(p.host || '127.0.0.1').trim(),
      port: parseInt(p.port, 10)
    })) : [];

    // Authorized validators whitelist (defaults to configured 12 validators)
    this.authorizedValidators = Array.isArray(options.authorizedValidators)
      ? options.authorizedValidators.map(v => String(v).trim().toUpperCase())
      : DEFAULT_12_VALIDATORS.map(v => v.validatorId);

    // Resource limits
    this.maxFrameSizeBytes = parseInt(options.maxFrameSizeBytes || process.env.MAX_FRAME_SIZE || 4 * 1024 * 1024, 10); // 4 MB
    this.maxQueueSize = parseInt(options.maxQueueSize || 1000, 10);
    this.maxConcurrentPeers = parseInt(options.maxConcurrentPeers || 32, 10);
    this.rateLimitPerSecond = parseInt(options.rateLimitPerSecond || 100, 10);

    // Timeouts
    this.connectionTimeoutMs = parseInt(options.connectionTimeoutMs || 5000, 10);
    this.handshakeTimeoutMs = parseInt(options.handshakeTimeoutMs || 3000, 10);
    this.heartbeatIntervalMs = parseInt(options.heartbeatIntervalMs || 2000, 10);
    this.peerInactivityTimeoutMs = parseInt(options.peerInactivityTimeoutMs || 6000, 10);

    // Reconnection policy
    this.reconnectBaseMs = parseInt(options.reconnectBaseMs || options.reconnectBaseIntervalMs || 500, 10);
    this.reconnectMaxMs = parseInt(options.reconnectMaxMs || options.reconnectMaxIntervalMs || 10000, 10);

    // TLS Settings
    this.useTLS = options.useTLS !== undefined 
      ? Boolean(options.useTLS) 
      : (options.tls !== undefined ? Boolean(options.tls) : (process.env.P2P_USE_TLS !== 'false'));
    this.tlsOptions = options.tlsOptions || {};
  }

  get tls() {
    return this.useTLS;
  }

  get reconnectBaseIntervalMs() {
    return this.reconnectBaseMs;
  }

  get reconnectMaxIntervalMs() {
    return this.reconnectMaxMs;
  }

  get maxPeers() {
    return this.maxConcurrentPeers;
  }

  /**
   * Validate configuration values and throw NetworkError if invalid
   */
  validate() {
    if (!this.validatorId) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, 'validatorId is required');
    }

    if (!/^VAL-\d{2}$/i.test(this.validatorId) && !this.validatorId.startsWith('TEST-VAL')) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Invalid validatorId format: '${this.validatorId}'`);
    }

    if (isNaN(this.listenPort) || this.listenPort < 1 || this.listenPort > 65535) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Invalid listenPort: ${this.listenPort}`);
    }

    if (!this.networkId) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, 'networkId cannot be empty');
    }

    if (isNaN(this.chainId) || this.chainId <= 0) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Invalid chainId: ${this.chainId}`);
    }

    if (this.protocolVersion < 1) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Unsupported protocolVersion: ${this.protocolVersion}`);
    }

    if (this.maxFrameSizeBytes < 1024 || this.maxFrameSizeBytes > 64 * 1024 * 1024) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `maxFrameSizeBytes out of safe bounds (1KB - 64MB): ${this.maxFrameSizeBytes}`);
    }

    if (this.maxQueueSize < 10) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `maxQueueSize must be at least 10: ${this.maxQueueSize}`);
    }

    if (this.connectionTimeoutMs < 100 || this.handshakeTimeoutMs < 100) {
      throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, 'Timeout settings must be >= 100ms');
    }

    // Check for duplicate peers in peer list
    const seenPeers = new Set();
    for (const peer of this.peers) {
      if (!peer.validatorId || isNaN(peer.port)) {
        throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Invalid peer configuration: ${JSON.stringify(peer)}`);
      }
      if (peer.validatorId === this.validatorId) {
        throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Cannot list self (${this.validatorId}) in peer configuration`);
      }
      if (seenPeers.has(peer.validatorId)) {
        throw new NetworkError(NetworkErrorCode.INVALID_CONFIGURATION, `Duplicate peer configured for validatorId '${peer.validatorId}'`);
      }
      seenPeers.add(peer.validatorId);
    }

    return true;
  }

  /**
   * Helper to build NetworkConfig for a specific validator using DEFAULT_12_VALIDATORS topology
   * @param {string} validatorId - e.g. 'VAL-01'
   * @param {object} [overrides]
   * @returns {NetworkConfig}
   */
  static forValidator(validatorId, overrides = {}) {
    const id = String(validatorId).trim().toUpperCase();
    const vConfig = DEFAULT_12_VALIDATORS.find(v => v.validatorId === id);
    const p2pPort = vConfig && vConfig.p2pPort ? vConfig.p2pPort : (5000 + (parseInt(id.replace('VAL-', ''), 10) || 1));

    // Construct peer list from other 11 validators
    const peers = DEFAULT_12_VALIDATORS
      .filter(v => v.validatorId !== id)
      .map(v => ({
        validatorId: v.validatorId,
        host: '127.0.0.1',
        port: v.p2pPort || (5000 + parseInt(v.validatorId.replace('VAL-', ''), 10))
      }));

    const config = new NetworkConfig({
      validatorId: id,
      listenPort: p2pPort,
      peers,
      ...overrides
    });

    return config;
  }

  toJSON() {
    return {
      networkId: this.networkId,
      chainId: this.chainId,
      protocolVersion: this.protocolVersion,
      validatorId: this.validatorId,
      listenHost: this.listenHost,
      listenPort: this.listenPort,
      peersCount: this.peers.length,
      peers: this.peers,
      authorizedValidatorsCount: this.authorizedValidators.length,
      maxFrameSizeBytes: this.maxFrameSizeBytes,
      maxQueueSize: this.maxQueueSize,
      connectionTimeoutMs: this.connectionTimeoutMs,
      handshakeTimeoutMs: this.handshakeTimeoutMs,
      heartbeatIntervalMs: this.heartbeatIntervalMs,
      useTLS: this.useTLS
    };
  }
}

module.exports = NetworkConfig;
module.exports.NetworkConfig = NetworkConfig;
