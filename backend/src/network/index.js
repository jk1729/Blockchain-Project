/**
 * PDSChain Network Layer Interface (Phase 9)
 * 
 * Provides authenticated P2P transport, framed streaming codec,
 * mutual Ed25519 identity handshakes, and validator network routing.
 */

const { NetworkError, NetworkErrorCode } = require('./NetworkErrors');
const NetworkConfig = require('./NetworkConfig');
const { MessageEnvelope, MessageType } = require('./MessageEnvelope');
const { MessageCodec, StreamDecoder } = require('./MessageCodec');
const TLSTransport = require('./TLSTransport');
const PeerAuthenticator = require('./PeerAuthenticator');
const { PeerConnection, ConnectionState } = require('./PeerConnection');
const PeerManager = require('./PeerManager');
const NetworkMetrics = require('./NetworkMetrics');
const MessageRouter = require('./MessageRouter');

// Handlers
const HandshakeHandler = require('./handlers/HandshakeHandler');
const HeartbeatHandler = require('./handlers/HeartbeatHandler');
const ProposalHandler = require('./handlers/ProposalHandler');
const VoteHandler = require('./handlers/VoteHandler');
const CertificateHandler = require('./handlers/CertificateHandler');
const RoundChangeHandler = require('./handlers/RoundChangeHandler');
const SyncHandler = require('./handlers/SyncHandler');
const DiscoveryHandler = require('./handlers/DiscoveryHandler');

module.exports = {
  NetworkError,
  NetworkErrorCode,
  NetworkConfig,
  MessageEnvelope,
  MessageType,
  MessageCodec,
  StreamDecoder,
  TLSTransport,
  PeerAuthenticator,
  PeerConnection,
  ConnectionState,
  PeerManager,
  NetworkMetrics,
  MessageRouter,
  HandshakeHandler,
  HeartbeatHandler,
  ProposalHandler,
  VoteHandler,
  CertificateHandler,
  RoundChangeHandler,
  SyncHandler,
  DiscoveryHandler
};
