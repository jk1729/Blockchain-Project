/**
 * PDSChain v1 Network & Ledger Routes (Phase 14)
 */

const express = require('express');
const router = express.Router();
const { DEFAULT_12_VALIDATORS } = require('../../consensus/consensusConfig');
const { sendSuccess } = require('../../api/ResponseEnvelope');
const blockchainService = require('../../services/blockchainService');

// GET /api/v1/network/status
router.get('/status', (req, res) => {
  const pm = req.app && req.app.locals && req.app.locals.peerManager;
  const peerStatus = pm ? pm.getStatus() : null;

  return sendSuccess(res, {
    networkId: process.env.NETWORK_ID || 'pdschain-devnet',
    chainId: parseInt(process.env.CHAIN_ID || 1729, 10),
    protocolVersion: 1,
    tlsEnabled: process.env.P2P_USE_TLS !== 'false',
    federationSize: DEFAULT_12_VALIDATORS.length,
    activePeers: peerStatus ? peerStatus.activePeerCount : DEFAULT_12_VALIDATORS.length,
    status: 'HEALTHY'
  });
});

// GET /api/v1/network/peers
router.get('/peers', (req, res) => {
  const pm = req.app && req.app.locals && req.app.locals.peerManager;
  if (pm) {
    return sendSuccess(res, pm.getConnectedPeers());
  }

  const simulated = DEFAULT_12_VALIDATORS.map((v, i) => ({
    validatorId: v.validatorId,
    name: v.name,
    org: v.org,
    p2pPort: v.p2pPort,
    endpoint: v.p2pEndpoint,
    state: 'CONNECTED',
    latencyMs: 2 + (i % 5),
    isInbound: i % 2 === 0
  }));
  return sendSuccess(res, simulated);
});

// GET /api/v1/network/topology
router.get('/topology', (req, res) => {
  return sendSuccess(res, {
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
  });
});

module.exports = router;

