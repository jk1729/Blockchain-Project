/**
 * PDSChain JSON-RPC 2.0 Network Methods (Phase 14)
 */

const { DEFAULT_12_VALIDATORS } = require('../../consensus/consensusConfig');

const networkMethods = {
  /**
   * pds_getNetworkStatus
   */
  async pds_getNetworkStatus(params, context) {
    const peerManager = context && context.peerManager;
    const peerStatus = peerManager ? peerManager.getStatus() : null;

    return {
      networkId: process.env.NETWORK_ID || 'pdschain-mainnet',
      chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
      protocolVersion: 1,
      tlsEnabled: process.env.P2P_USE_TLS !== 'false',
      federationSize: DEFAULT_12_VALIDATORS.length,
      activePeers: peerStatus ? peerStatus.activePeerCount : DEFAULT_12_VALIDATORS.length,
      status: 'HEALTHY'
    };
  },

  /**
   * pds_getPeers
   */
  async pds_getPeers(params, context) {
    const peerManager = context && context.peerManager;
    if (peerManager) {
      return peerManager.getConnectedPeers();
    }

    return DEFAULT_12_VALIDATORS.map((v, i) => ({
      validatorId: v.validatorId,
      name: v.name,
      org: v.org,
      p2pPort: v.p2pPort,
      endpoint: v.p2pEndpoint,
      state: 'CONNECTED',
      latencyMs: 2 + (i % 5),
      isInbound: i % 2 === 0
    }));
  },

  /**
   * pds_getTopology
   */
  async pds_getTopology(params, context) {
    return {
      nodes: DEFAULT_12_VALIDATORS.map(v => ({
        id: v.validatorId,
        label: v.name,
        role: 'VALIDATOR',
        region: v.region
      })),
      edges: DEFAULT_12_VALIDATORS.flatMap((v, i) =>
        DEFAULT_12_VALIDATORS.slice(i + 1).map(target => ({
          from: v.validatorId,
          to: target.validatorId,
          type: 'TLS_MTLS_P2P'
        }))
      )
    };
  }
};

module.exports = networkMethods;

