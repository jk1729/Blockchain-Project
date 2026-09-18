const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const NetworkMetrics = require('../network/NetworkMetrics');

// Shared singleton metrics instance for the backend process
const defaultMetrics = new NetworkMetrics();

class NetworkController {
  constructor(peerManager = null, metrics = null) {
    this.peerManager = peerManager;
    this.metrics = metrics || defaultMetrics;
  }

  setPeerManager(pm) {
    this.peerManager = pm;
    if (pm && pm.metrics) {
      this.metrics = pm.metrics;
    }
  }

  getStatus = (req, res) => {
    const peerStatus = this.peerManager ? this.peerManager.getStatus() : null;
    res.json({
      success: true,
      networkId: process.env.NETWORK_ID || 'pdschain-devnet',
      chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
      protocolVersion: 1,
      tlsEnabled: process.env.P2P_USE_TLS !== 'false',
      federationSize: DEFAULT_12_VALIDATORS.length,
      activePeers: peerStatus ? peerStatus.activePeerCount : 0,
      status: peerStatus && peerStatus.activePeerCount >= 8 ? 'HEALTHY' : 'OPERATIONAL',
      timestamp: new Date().toISOString()
    });
  };

  getPeers = (req, res) => {
    if (this.peerManager) {
      return res.json({
        success: true,
        count: this.peerManager.peers.size,
        peers: this.peerManager.getConnectedPeers()
      });
    }

    // Default topology simulation view if standalone API
    const simulatedPeers = DEFAULT_12_VALIDATORS.map((v, i) => ({
      validatorId: v.validatorId,
      name: v.name,
      org: v.org,
      p2pPort: v.p2pPort,
      endpoint: v.p2pEndpoint,
      state: 'CONNECTED',
      latencyMs: 2 + (i % 5),
      isInbound: i % 2 === 0,
      uptimeSeconds: Math.floor(process.uptime())
    }));

    res.json({
      success: true,
      count: simulatedPeers.length,
      peers: simulatedPeers
    });
  };

  getTopology = (req, res) => {
    const topology = DEFAULT_12_VALIDATORS.map(v => ({
      validatorId: v.validatorId,
      name: v.name,
      org: v.org,
      apiPort: v.port,
      apiEndpoint: v.endpoint,
      p2pPort: v.p2pPort,
      p2pEndpoint: v.p2pEndpoint,
      publicKey: v.publicKey,
      status: v.status || 'Online',
      trustConfiguration: v.trustConfiguration
    }));

    res.json({
      success: true,
      networkId: process.env.NETWORK_ID || 'pdschain-devnet',
      chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
      totalValidators: topology.length,
      globalAgreementThreshold: 9,
      quorumSliceThreshold: 3,
      quorumSliceSize: 4,
      validators: topology
    });
  };

  getMetrics = (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('text/plain')) {
      res.setHeader('Content-Type', 'text/plain');
      return res.send(this.metrics.toPrometheusFormat());
    }

    res.json({
      success: true,
      metrics: this.metrics.getSnapshot()
    });
  };

  getSyncStatus = (req, res) => {
    const peerStatus = this.peerManager ? this.peerManager.getStatus() : null;
    const syncState = (this.peerManager && this.peerManager.syncState)
      ? this.peerManager.syncState.getSnapshot()
      : {
          state: 'CURRENT',
          isConsensusReady: true,
          localFinalizedHeight: 1,
          targetHeight: 1,
          progressPercentage: 100,
          verificationStatus: 'PASSED',
          stateRootStatus: 'VALID',
          journalReplayStatus: 'REPLAYED',
          timestamp: new Date().toISOString()
        };

    res.json({
      success: true,
      sync: syncState,
      activePeers: peerStatus ? peerStatus.activePeerCount : 0,
      timestamp: new Date().toISOString()
    });
  };
}

const defaultController = new NetworkController();

module.exports = defaultController;
module.exports.NetworkController = NetworkController;

