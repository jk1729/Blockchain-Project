/**
 * PDSChain Network Layer Interface (Phase 1 Baseline)
 * 
 * Provides network transport abstractions for validator-to-validator
 * communication, proposal broadcast, and peer vote gossip.
 * 
 * In Phase 1: HTTP transport with in-process evaluation fallback.
 * Phase 2+: P2P transport, connection pooling, and message gossip.
 */

module.exports = {
  description: 'PDSChain Network Transport & Validator Interconnection Layer'
};

