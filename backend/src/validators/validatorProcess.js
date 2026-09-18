/**
 * PDSChain Standalone Multi-Process Validator Daemon (Phase 9)
 * 
 * Runs as an isolated operating-system process with dedicated:
 * - Process ID (PID)
 * - SQLite Database storage
 * - Consensus Write-Ahead Journal
 * - Cryptographic Ed25519 identity and private key
 * - Authenticated P2P Transport & MessageCodec
 * - Consensus State Machine, VoteStore, and Finality Engine
 * - HTTP Status & Query API
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const { DEFAULT_12_VALIDATORS } = require('../consensus/consensusConfig');
const Blockchain = require('../blockchain/Blockchain');
const Block = require('../blockchain/Block');
const Transaction = require('../blockchain/Transaction');
const ValidatorVote = require('../consensus/ValidatorVote');
const VoteStore = require('../consensus/VoteStore');
const QuorumEngine = require('../consensus/QuorumEngine');
const FinalityEngine = require('../consensus/FinalityEngine');
const ConsensusJournal = require('../consensus/ConsensusJournal');
const { ConsensusState, ConsensusStateMachine } = require('../consensus/ConsensusStateMachine');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const ValidatorNode = require('../consensus/ValidatorNode');
const QuorumSlice = require('../consensus/QuorumSlice');
const { getParticipantPrivateKey, getPublicParticipantInfo } = require('../blockchain/identity/keyManager');

const {
  NetworkConfig,
  MessageEnvelope,
  MessageType,
  PeerAuthenticator,
  PeerManager,
  NetworkMetrics,
  MessageRouter,
  ProposalHandler,
  VoteHandler,
  CertificateHandler,
  RoundChangeHandler,
  SyncHandler,
  DiscoveryHandler
} = require('../network');
const { LedgerSyncState, SyncStatus } = require('../blockchain/sync/LedgerSyncState');
const LedgerCheckpoint = require('../blockchain/sync/LedgerCheckpoint');
const CheckpointManager = require('../blockchain/sync/CheckpointManager');
const SyncPlanner = require('../blockchain/sync/SyncPlanner');
const LedgerRecoveryManager = require('../blockchain/sync/LedgerRecoveryManager');
const { ValidatorConfig, ConfigurationError } = require('../config/validatorConfig');
const { StorageLayout, StorageLockError } = require('../storage/StorageLayout');
const { IdentityProvisioner } = require('../blockchain/identity/IdentityProvisioner');
const { registerCustomParticipant } = require('../blockchain/identity/keyManager');
const { getBuildInfo } = require('../config/buildInfo');
const {
  KeyStore,
  CertificateManager,
  KeyRotationManager,
  PeerAuthorizationRegistry
} = require('../security');
const {
  EventStore,
  EventBus,
  EventStreamManager,
  EventMetrics,
  BlockchainEvent,
  EVENT_TYPES,
  EVENT_CATEGORIES,
  EVENT_SEVERITIES,
  FINALITY_STATUS
} = require('../events');
const eventRoutes = require('../routes/eventRoutes');
const v1Routes = require('../routes/v1');
const { rpcMiddleware } = require('../rpc');
const { requestTracingMiddleware } = require('../api/RequestTracing');
const { versionMiddleware } = require('../api/ApiVersioning');
const logger = require('../utils/logger');

class ValidatorProcess {
  constructor(options = {}) {
    this.validatorId = String(options.validatorId || process.env.VALIDATOR_ID || process.argv[2] || 'VAL-01').toUpperCase().trim();
    
    // Determine configuration
    if (options instanceof ValidatorConfig) {
      this.config = options;
    } else if (process.env.VALIDATOR_CONFIG_FILE && fs.existsSync(process.env.VALIDATOR_CONFIG_FILE)) {
      this.config = ValidatorConfig.fromFile(process.env.VALIDATOR_CONFIG_FILE, { validatorId: this.validatorId, ...options });
    } else {
      this.config = ValidatorConfig.forValidator(this.validatorId, options);
    }

    this.vConfig = {
      validatorId: this.validatorId,
      name: this.config.institutionName || `Validator ${this.validatorId}`,
      org: this.config.operatorName || 'PDSChain Federation',
      port: this.config.apiPort,
      p2pPort: this.config.listenPort
    };

    this.apiPort = this.config.apiPort;
    this.p2pPort = this.config.listenPort;
    this.useTLS = this.config.useTLS;

    // Storage layout & isolation
    this.storageLayout = new StorageLayout(this.validatorId, this.config.dataDir);
    this.dataDir = this.storageLayout.dataDir;
    this.journalPath = this.config.journalPath || this.storageLayout.journalPath;
    this.dbStoragePath = this.config.dbStoragePath || this.storageLayout.dbPath;
    this.checkpointPath = this.config.checkpointPath || this.storageLayout.checkpointPath;
    this.identityPath = this.config.identityPath || this.storageLayout.identityPath;
    this.eventsPath = this.config.eventsPath || this.storageLayout.eventsPath;

    this.status = 'Online';
    this.blockchain = null;
    this.journal = null;
    this.voteStore = null;
    this.stateMachine = null;
    this.peerManager = null;
    this.messageRouter = null;
    this.syncState = new LedgerSyncState({ validatorId: this.validatorId });
    this.checkpointManager = new CheckpointManager({ filepath: this.checkpointPath });
    this.syncPlanner = null;
    this.recoveryManager = null;
    this.discoveryHandler = null;
    this.httpServer = null;
    this.isShuttingDown = false;

    // Phase 12 Security subsystem
    this.keyStore = null;
    this.certificateManager = null;
    this.keyRotationManager = null;
    this.peerRegistry = null;

    // Phase 13 Events subsystem
    this.eventBus = new EventBus();
    this.eventStore = new EventStore({ filepath: this.eventsPath, eventBus: this.eventBus });
    this.streamManager = new EventStreamManager({ eventStore: this.eventStore, eventBus: this.eventBus });
    this.eventMetrics = new EventMetrics(this.eventBus);
  }

  async start() {
    logger.info(`[ValidatorProcess] Initializing isolated daemon for ${this.validatorId} (PID: ${process.pid})`);

    // 0. Validate configuration
    this.config.validate();

    // 0.1 Acquire PID lock
    this.storageLayout.acquirePidLock();

    // 0.2 Provision or load identity
    if (fs.existsSync(this.identityPath)) {
      try {
        const loadedIdentity = IdentityProvisioner.loadFromFile(this.identityPath, this.validatorId);
        registerCustomParticipant({
          entityId: this.validatorId,
          entityType: 'VALIDATOR',
          address: loadedIdentity.address,
          publicKey: loadedIdentity.publicKey,
          privateKey: loadedIdentity.privateKey
        });
        logger.info(`[ValidatorProcess] Loaded provisioned identity from ${this.identityPath}`);
      } catch (err) {
        logger.error(`[ValidatorProcess] Failed to load identity: ${err.message}`);
        throw err;
      }
    } else if (this.config.isProduction) {
      throw new Error(`Identity file required in production mode at '${this.identityPath}'`);
    }

    // 0.3 Initialize event store
    await this.eventStore.initialize();

    // 1. Initialize local blockchain with Genesis
    this.blockchain = new Blockchain();
    this.blockchain.setEventBus(this.eventBus);
    this.blockchain.getLatestBlock();

    // 2. Initialize consensus journal
    this.journal = new ConsensusJournal({
      journalPath: this.journalPath,
      validatorId: this.validatorId
    });

    // 3. Consensus state machine & vote store
    this.voteStore = new VoteStore();
    this.stateMachine = new ConsensusStateMachine();

    // 4. Build validator node registry for local quorum engine
    const nodesMap = new Map();
    for (const v of DEFAULT_12_VALIDATORS) {
      nodesMap.set(v.validatorId, new ValidatorNode(v));
    }
    this.quorumEngine = new QuorumEngine(nodesMap);
    this.finalityEngine = new FinalityEngine(nodesMap);

    // 5. Initialize Security Subsystem (Phase 12)
    const caCertPath = this.config.tlsCaPath || process.env.TLS_CA_PATH || null;
    const certPath = this.config.tlsCertPath || process.env.TLS_CERT_PATH || null;
    const keyPath = this.config.tlsKeyPath || process.env.TLS_KEY_PATH || null;

    if (certPath && keyPath && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      this.certificateManager = new CertificateManager({
        certPath,
        keyPath,
        caPath: caCertPath
      });
    } else {
      this.certificateManager = new CertificateManager();
    }

    this.peerRegistry = new PeerAuthorizationRegistry({
      strictMode: Boolean(this.config.isProduction),
      initialPeers: DEFAULT_12_VALIDATORS.map(v => ({ validatorId: v.validatorId }))
    });

    const initialPubInfo = getPublicParticipantInfo(this.validatorId);
    const initialPrivKey = getParticipantPrivateKey(this.validatorId);
    const initialPubKey = initialPubInfo ? initialPubInfo.publicKey : null;
    const initialAddr = initialPubInfo ? initialPubInfo.address : null;

    if (initialPubKey) {
      this.keyStore = KeyStore.fromCredentials({
        validatorId: this.validatorId,
        consensus: {
          publicKey: initialPubKey,
          privateKey: initialPrivKey,
          address: initialAddr
        },
        transport: this.certificateManager && this.certificateManager.certPem ? {
          cert: this.certificateManager.certPem,
          key: this.certificateManager.keyPem,
          ca: this.certificateManager.caPem
        } : null
      });

      this.keyRotationManager = new KeyRotationManager({
        validatorId: this.validatorId,
        initialPublicKey: initialPubKey,
        initialPrivateKey: initialPrivKey,
        initialAddress: initialAddr,
        startHeight: 0
      });
    }

    const tlsOptions = {};
    if (this.certificateManager && this.certificateManager.certPem) {
      tlsOptions.cert = this.certificateManager.certPem;
      tlsOptions.key = this.certificateManager.keyPem;
      if (this.certificateManager.caPem) {
        tlsOptions.ca = this.certificateManager.caPem;
        tlsOptions.requestCert = true;
        tlsOptions.rejectUnauthorized = true;
      }
    }

    // 6. Initialize Network Configuration & Peer Manager
    this.networkConfig = NetworkConfig.forValidator(this.validatorId, {
      listenPort: this.p2pPort,
      listenHost: process.env.P2P_HOST || '127.0.0.1',
      useTLS: this.useTLS,
      tlsOptions,
      networkId: process.env.NETWORK_ID || 'pdschain-devnet'
    });

    this.authenticator = new PeerAuthenticator(this.validatorId);
    this.metrics = new NetworkMetrics();

    this.peerManager = new PeerManager({
      config: this.networkConfig,
      authenticator: this.authenticator,
      metrics: this.metrics,
      certificateManager: this.certificateManager,
      peerAuthorizationRegistry: this.peerRegistry
    });

    this.messageRouter = new MessageRouter({
      config: this.networkConfig,
      peerManager: this.peerManager,
      metrics: this.metrics
    });

    // 6. Initialize SyncPlanner & LedgerRecoveryManager
    this.syncPlanner = new SyncPlanner({
      config: this.networkConfig,
      peerManager: this.peerManager,
      blockchain: this.blockchain,
      syncState: this.syncState,
      checkpointManager: this.checkpointManager
    });

    this.recoveryManager = new LedgerRecoveryManager({
      blockchain: this.blockchain,
      journal: this.journal,
      checkpointManager: this.checkpointManager,
      syncState: this.syncState,
      metrics: this.metrics
    });

    // Run startup recovery & state reconciliation
    await this.recoveryManager.recover();

    // 7. Setup Consensus Handlers
    this._setupConsensusHandlers();

    // 8. Start P2P Transport
    await this.peerManager.start();

    // 9. Start HTTP API
    await this._startHttpApi();

    // 10. Setup IPC & Signals
    this._setupIpc();

    logger.info(`[ValidatorProcess] ${this.validatorId} ONLINE [PID: ${process.pid}, API: ${this.apiPort}, P2P: ${this.p2pPort}]`);

    if (process.send) {
      process.send({
        type: 'READY',
        pid: process.pid,
        validatorId: this.validatorId,
        apiPort: this.apiPort,
        p2pPort: this.p2pPort
      });
    }
  }

  _setupConsensusHandlers() {
    // 1. Proposal Handler
    this.proposalHandler = new ProposalHandler({
      config: this.networkConfig,
      onProposal: async (payload, peerConn) => this._onProposalReceived(payload, peerConn)
    });
    this.messageRouter.registerHandler(MessageType.PROPOSAL, (env, conn) => this.proposalHandler.handle(env, conn));

    // 2. Vote Handler
    this.voteHandler = new VoteHandler({
      config: this.networkConfig,
      voteStore: this.voteStore,
      onVote: async (vote, peerConn, recordResult) => this._onVoteReceived(vote, peerConn, recordResult)
    });
    this.messageRouter.registerHandler(MessageType.VOTE, (env, conn) => this.voteHandler.handle(env, conn));

    // 3. Certificate Handler
    this.certificateHandler = new CertificateHandler({
      config: this.networkConfig,
      onCertificate: async (cert, peerConn) => this._onCertificateReceived(cert, peerConn)
    });
    this.messageRouter.registerHandler(MessageType.CERTIFICATE, (env, conn) => this.certificateHandler.handle(env, conn));

    // 4. Round Change Handler
    this.roundChangeHandler = new RoundChangeHandler({
      config: this.networkConfig,
      onRoundChange: async (payload, peerConn) => this._onRoundChangeReceived(payload, peerConn)
    });
    this.messageRouter.registerHandler(MessageType.ROUND_CHANGE, (env, conn) => this.roundChangeHandler.handle(env, conn));

    // 5. Sync Handler
    this.syncHandler = new SyncHandler({
      config: this.networkConfig,
      blockchain: this.blockchain,
      peerManager: this.peerManager,
      syncState: this.syncState,
      checkpointManager: this.checkpointManager,
      metrics: this.metrics
    });
    this.messageRouter.registerHandler(MessageType.SYNC_REQUEST, (env, conn) => this.syncHandler.handleSyncRequest(env, conn));
    this.messageRouter.registerHandler(MessageType.SYNC_RESPONSE, (env, conn) => this.syncHandler.handleSyncResponse(env, conn));

    // 6. Discovery Handler
    this.discoveryHandler = new DiscoveryHandler({
      config: this.networkConfig,
      blockchain: this.blockchain,
      checkpointManager: this.checkpointManager
    });
    this.messageRouter.registerHandler(MessageType.HEIGHT_DISCOVERY_REQUEST, (env, conn) => this.discoveryHandler.handleHeightDiscoveryRequest(env, conn));
    this.messageRouter.registerHandler(MessageType.ANCESTOR_REQUEST, (env, conn) => this.discoveryHandler.handleAncestorRequest(env, conn));
    this.messageRouter.registerHandler(MessageType.CHECKPOINT_REQUEST, (env, conn) => this.discoveryHandler.handleCheckpointRequest(env, conn));
  }

  async _onProposalReceived(payload, peerConn) {
    if (this.status !== 'Online' || !this.syncState.isConsensusReady()) {
      logger.info(`[ValidatorProcess] ${this.validatorId} consensus participation disabled (nodeStatus=${this.status}, syncState=${this.syncState.state}); ignoring proposal`);
      return;
    }

    const { blockHeight, round, candidateBlock } = payload;
    const latest = this.blockchain.getLatestBlock();

    // Validate block height continuity
    const candidateNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10);
    const isValidHeight = candidateNumber === latest.blockNumber + 1;
    const isValidPrevHash = candidateBlock.previousHash === latest.blockHash;

    const voteDecision = (isValidHeight && isValidPrevHash) ? 'ACCEPT' : 'REJECT';
    const reason = voteDecision === 'ACCEPT' ? 'Block verified valid' : 'Height or previousHash continuity invalid';

    // Sign local vote
    const privKey = getParticipantPrivateKey(this.validatorId);
    const vote = new ValidatorVote({
      chainId: this.networkConfig.chainId,
      validatorId: this.validatorId,
      proposalId: candidateBlock.proposalId || candidateBlock.hash,
      blockNumber: candidateNumber,
      blockHash: candidateBlock.blockHash || candidateBlock.hash,
      stateRoot: candidateBlock.stateRoot || '',
      round: round || 0,
      vote: voteDecision,
      reason
    });

    if (privKey) {
      vote.sign(privKey);
    }

    // Record local vote in voteStore
    this.voteStore.recordVote(vote);
    this.journal.append('VOTE_CAST', vote.toUnsignedPayload());

    // Broadcast vote to all peers
    const voteEnv = new MessageEnvelope({
      version: this.networkConfig.protocolVersion,
      networkId: this.networkConfig.networkId,
      chainId: this.networkConfig.chainId,
      type: MessageType.VOTE,
      senderId: this.validatorId,
      payload: { vote }
    });

    this.peerManager.broadcast(voteEnv);
    logger.info(`[ValidatorProcess] ${this.validatorId} voted ${voteDecision} on Block #${candidateNumber} (round ${round})`);

    if (this.eventBus) {
      try {
        this.eventBus.publish(BlockchainEvent.create({
          type: EVENT_TYPES.CONSENSUS_VOTE_CAST,
          category: EVENT_CATEGORIES.CONSENSUS,
          severity: EVENT_SEVERITIES.INFO,
          finalityStatus: FINALITY_STATUS.PENDING,
          blockHeight: candidateNumber,
          source: 'consensus',
          payload: {
            validatorId: this.validatorId,
            vote: voteDecision,
            round: round || 0,
            reason
          }
        }));
      } catch (e) {
        logger.warn(`Failed to emit CONSENSUS_VOTE_CAST: ${e.message}`);
      }
    }
  }

  async _onVoteReceived(vote, peerConn, recordResult) {
    if (!this.syncState.isConsensusReady()) {
      return;
    }
    if (recordResult && recordResult.success) {
      this.journal.append('VOTE_RECORDED', {
        from: vote.validatorId,
        height: vote.blockNumber,
        round: vote.round,
        decision: vote.vote
      });

      if (this.eventBus) {
        try {
          this.eventBus.publish(BlockchainEvent.create({
            type: EVENT_TYPES.CONSENSUS_VOTE_RECEIVED,
            category: EVENT_CATEGORIES.CONSENSUS,
            severity: EVENT_SEVERITIES.INFO,
            finalityStatus: FINALITY_STATUS.PENDING,
            blockHeight: vote.blockNumber,
            source: 'consensus',
            payload: {
              validatorId: vote.validatorId,
              vote: vote.vote,
              round: vote.round
            }
          }));
        } catch (e) {
          logger.warn(`Failed to emit CONSENSUS_VOTE_RECEIVED: ${e.message}`);
        }
      }
    }
  }

  async _onCertificateReceived(cert, peerConn) {
    if (this.eventBus) {
      try {
        this.eventBus.publish(BlockchainEvent.create({
          type: EVENT_TYPES.CONSENSUS_CERTIFICATE_FORMED,
          category: EVENT_CATEGORIES.CONSENSUS,
          severity: EVENT_SEVERITIES.INFO,
          finalityStatus: FINALITY_STATUS.FINALIZED,
          blockHeight: cert.blockNumber,
          source: 'consensus',
          payload: {
            blockNumber: cert.blockNumber,
            certificateHash: cert.certificateHash || null
          }
        }));
      } catch (e) {
        logger.warn(`Failed to emit CONSENSUS_CERTIFICATE_FORMED: ${e.message}`);
      }
    }

    const latest = this.blockchain.getLatestBlock();
    if (cert.blockNumber > latest.blockNumber) {
      logger.info(`[ValidatorProcess] ${this.validatorId} received certificate for block #${cert.blockNumber}; local is #${latest.blockNumber}, requesting sync`);
      const neededCount = Math.min(50, cert.blockNumber - latest.blockNumber);
      await this.syncHandler.requestSyncRange(peerConn.peerValidatorId, latest.blockNumber + 1, cert.blockNumber, neededCount);
    }
  }

  async _onRoundChangeReceived(payload, peerConn) {
    this.journal.append('ROUND_CHANGE', payload);

    if (this.eventBus) {
      try {
        this.eventBus.publish(BlockchainEvent.create({
          type: EVENT_TYPES.CONSENSUS_ROUND_CHANGED,
          category: EVENT_CATEGORIES.CONSENSUS,
          severity: EVENT_SEVERITIES.WARNING,
          finalityStatus: FINALITY_STATUS.PENDING,
          blockHeight: payload.blockHeight || payload.height || 0,
          source: 'consensus',
          payload
        }));
      } catch (e) {
        logger.warn(`Failed to emit CONSENSUS_ROUND_CHANGED: ${e.message}`);
      }
    }
  }

  async _startHttpApi() {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Phase 14: Request Tracing & Versioning
    app.use(requestTracingMiddleware);
    app.use(versionMiddleware);

    // Context bindings
    app.locals.peerManager = this.peerManager;
    app.locals.eventStore = this.eventStore;
    app.locals.eventBus = this.eventBus;
    app.locals.streamManager = this.streamManager;
    app.locals.eventMetrics = this.eventMetrics;

    // Phase 14: Mount JSON-RPC 2.0 Endpoints
    app.post('/rpc', rpcMiddleware);
    app.post('/rpc/v1', rpcMiddleware);

    // Phase 14: Mount v1 API Routes
    app.use('/api/v1', v1Routes);

    // Phase 13: Mount Event Subsystem
    app.use('/api/events', eventRoutes);
    app.use('/events', eventRoutes);

    // Health - Legacy & Aggregate
    app.get('/health', (req, res) => {
      res.json({
        status: 'OK',
        validatorId: this.validatorId,
        nodeStatus: this.status,
        syncState: this.syncState ? this.syncState.state : 'UNKNOWN',
        isConsensusReady: this.syncState ? this.syncState.isConsensusReady() : false,
        apiPort: this.apiPort,
        p2pPort: this.p2pPort,
        pid: process.pid,
        uptime: process.uptime()
      });
    });

    // Phase 11: Liveness Probe
    app.get('/health/live', (req, res) => {
      if (this.isShuttingDown) {
        return res.status(503).json({ status: 'TERMINATING', validatorId: this.validatorId });
      }
      res.status(200).json({
        status: 'LIVE',
        validatorId: this.validatorId,
        pid: process.pid,
        uptime: process.uptime()
      });
    });

    // Phase 11: Readiness Probe
    app.get('/health/ready', (req, res) => {
      const isReady = !this.isShuttingDown && this.blockchain && this.peerManager;
      if (!isReady) {
        return res.status(503).json({
          status: 'NOT_READY',
          validatorId: this.validatorId,
          subsystems: {
            storage: Boolean(this.storageLayout && this.storageLayout.hasPidLock),
            blockchain: Boolean(this.blockchain),
            p2p: Boolean(this.peerManager)
          }
        });
      }
      res.status(200).json({
        status: 'READY',
        validatorId: this.validatorId,
        pid: process.pid,
        subsystems: {
          storage: true,
          blockchain: true,
          p2p: true
        }
      });
    });

    // Phase 11: Consensus Readiness Probe
    app.get('/health/consensus', (req, res) => {
      const isConsensusReady = !this.isShuttingDown && this.syncState && this.syncState.isConsensusReady();
      if (!isConsensusReady) {
        return res.status(503).json({
          status: 'NOT_CONSENSUS_READY',
          validatorId: this.validatorId,
          syncState: this.syncState ? this.syncState.state : 'UNKNOWN',
          isConsensusReady: false
        });
      }
      res.status(200).json({
        status: 'CONSENSUS_READY',
        validatorId: this.validatorId,
        syncState: this.syncState.state,
        isConsensusReady: true,
        blockHeight: this.blockchain ? this.blockchain.getLatestBlock().blockNumber : 0
      });
    });

    // Phase 11: Version & Packaging Diagnostics
    app.get('/version', (req, res) => {
      res.json(getBuildInfo({
        protocolVersion: this.config ? this.config.protocolVersion : 1,
        chainId: this.config ? this.config.chainId : 1729,
        networkId: this.config ? this.config.networkId : 'pdschain-mainnet'
      }));
    });

    // Node Status
    app.get('/status', (req, res) => {
      const latest = this.blockchain ? this.blockchain.getLatestBlock() : null;
      res.json({
        validatorId: this.validatorId,
        name: this.vConfig.name,
        org: this.vConfig.org,
        status: this.status,
        syncState: this.syncState ? this.syncState.state : 'UNKNOWN',
        isConsensusReady: this.syncState ? this.syncState.isConsensusReady() : false,
        apiPort: this.apiPort,
        p2pPort: this.p2pPort,
        pid: process.pid,
        blockHeight: latest ? latest.blockNumber : 0,
        latestBlockHash: latest ? latest.blockHash : null,
        checkpoint: this.checkpointManager && this.checkpointManager.getLatestCheckpoint() ? this.checkpointManager.getLatestCheckpoint().toJSON() : null,
        activePeerCount: this.peerManager ? this.peerManager.peers.size : 0,
        peers: this.peerManager ? this.peerManager.getConnectedPeers() : [],
        metrics: this.metrics ? this.metrics.getSnapshot() : null,
        uptime: process.uptime()
      });
    });

    // Sync & Ledger Status endpoints (Phase 10)
    app.get('/sync/status', (req, res) => {
      res.json({
        success: true,
        validatorId: this.validatorId,
        sync: this.syncState ? this.syncState.getSnapshot() : null,
        checkpoint: this.checkpointManager && this.checkpointManager.getLatestCheckpoint() ? this.checkpointManager.getLatestCheckpoint().toJSON() : null
      });
    });

    // Phase 12 TLS/mTLS & Key Management health endpoints
    app.get('/health/tls', (req, res) => {
      res.json(this.certificateManager ? this.certificateManager.getHealthStatus() : {
        configured: Boolean(this.useTLS),
        status: this.useTLS ? 'OK' : 'DISABLED',
        useTLS: Boolean(this.useTLS)
      });
    });

    app.get('/health/keys', (req, res) => {
      res.json({
        validatorId: this.validatorId,
        keyStore: this.keyStore ? this.keyStore.toSafeObject() : null,
        rotation: this.keyRotationManager ? this.keyRotationManager.getStatus() : null,
        authorizations: this.peerRegistry ? this.peerRegistry.getStatus() : null
      });
    });

    app.post('/admin/tls/reload', (req, res) => {
      try {
        if (!this.certificateManager) {
          return res.status(400).json({ success: false, message: 'CertificateManager is not configured' });
        }
        const { certPath, keyPath } = req.body || {};
        const result = this.certificateManager.reload(certPath, keyPath);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message, code: err.code });
      }
    });

    app.get('/ledger/status', (req, res) => {
      const latest = this.blockchain ? this.blockchain.getLatestBlock() : null;
      res.json({
        success: true,
        validatorId: this.validatorId,
        state: this.syncState ? this.syncState.state : 'UNKNOWN',
        isConsensusReady: this.syncState ? this.syncState.isConsensusReady() : false,
        blockHeight: latest ? latest.blockNumber : 0,
        latestBlockHash: latest ? latest.blockHash : null,
        checkpoint: this.checkpointManager && this.checkpointManager.getLatestCheckpoint() ? this.checkpointManager.getLatestCheckpoint().toJSON() : null,
        sync: this.syncState ? this.syncState.getSnapshot() : null
      });
    });

    // Toggle Status (fault simulation)
    app.post('/status', (req, res) => {
      const { status } = req.body;
      if (['Online', 'Offline', 'Degraded'].includes(status)) {
        this.status = status;
        logger.info(`[ValidatorProcess] ${this.validatorId} status changed to ${this.status}`);
        return res.json({ success: true, validatorId: this.validatorId, status: this.status });
      }
      res.status(400).json({ success: false, message: 'Invalid status' });
    });

    // Metrics endpoint
    app.get('/metrics', (req, res) => {
      if (req.headers.accept && req.headers.accept.includes('text/plain')) {
        res.setHeader('Content-Type', 'text/plain');
        return res.send(this.metrics ? this.metrics.toPrometheusFormat() : '');
      }
      res.json(this.metrics ? this.metrics.getSnapshot() : {});
    });

    // Blocks
    app.get('/blocks', (req, res) => {
      res.json({
        length: this.blockchain ? this.blockchain.chain.length : 0,
        blocks: this.blockchain ? this.blockchain.chain.map(b => b.toJSON()) : []
      });
    });

    app.get('/blocks/latest', (req, res) => {
      const latest = this.blockchain ? this.blockchain.getLatestBlock() : null;
      res.json(latest ? latest.toJSON() : null);
    });

    // Peers
    app.get('/peers', (req, res) => {
      res.json({
        validatorId: this.validatorId,
        count: this.peerManager ? this.peerManager.peers.size : 0,
        peers: this.peerManager ? this.peerManager.getConnectedPeers() : []
      });
    });

    return new Promise((resolve) => {
      this.httpServer = app.listen(this.apiPort, () => {
        resolve(this.httpServer);
      });
    });
  }

  _setupIpc() {
    process.on('message', async (msg) => {
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'GET_STATUS': {
          const latest = this.blockchain ? this.blockchain.getLatestBlock() : null;
          if (process.send) {
            process.send({
              type: 'STATUS_RESPONSE',
              correlationId: msg.correlationId,
              data: {
                validatorId: this.validatorId,
                pid: process.pid,
                status: this.status,
                syncState: this.syncState ? this.syncState.state : 'UNKNOWN',
                isConsensusReady: this.syncState ? this.syncState.isConsensusReady() : false,
                apiPort: this.apiPort,
                p2pPort: this.p2pPort,
                blockHeight: latest ? latest.blockNumber : 0,
                checkpoint: this.checkpointManager && this.checkpointManager.getLatestCheckpoint() ? this.checkpointManager.getLatestCheckpoint().toJSON() : null,
                peersCount: this.peerManager ? this.peerManager.peers.size : 0,
                connectedPeers: this.peerManager ? this.peerManager.getConnectedPeers() : [],
                uptime: process.uptime()
              }
            });
          }
          break;
        }

        case 'SET_STATUS': {
          if (msg.status && ['Online', 'Offline', 'Degraded'].includes(msg.status)) {
            this.status = msg.status;
          }
          break;
        }

        case 'STOP': {
          await this.stop('Parent IPC STOP request');
          process.exit(0);
          break;
        }
      }
    });

    process.on('SIGINT', async () => {
      await this.stop('SIGINT received');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.stop('SIGTERM received');
      process.exit(0);
    });
  }

  async stop(reason = 'Normal shutdown') {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    logger.info(`[ValidatorProcess] Stopping ${this.validatorId} (${reason})`);

    if (this.metrics) {
      this.metrics.setLive(false);
      this.metrics.setReady(false);
      this.metrics.setConsensusReady(false);
    }

    if (this.messageRouter) {
      this.messageRouter.stop();
    }
    if (this.peerManager) {
      await this.peerManager.stop();
    }
    if (this.httpServer) {
      await new Promise(r => this.httpServer.close(r));
      this.httpServer = null;
    }
    if (this.streamManager) {
      this.streamManager.closeAll();
    }
    if (this.eventStore) {
      this.eventStore.close();
    }
    if (this.eventBus) {
      this.eventBus.clear();
    }
    if (this.journal) {
      this.journal.close();
    }
    if (this.storageLayout) {
      this.storageLayout.releasePidLock();
    }

    logger.info(`[ValidatorProcess] ${this.validatorId} stopped successfully`);
  }
}

// When executed directly from CLI or child_process.fork:
if (require.main === module) {
  const daemon = new ValidatorProcess();
  daemon.start().catch((err) => {
    logger.error(`[ValidatorProcess] Fatal startup error: ${err.message}`, err.stack);
    process.exit(1);
  });
}

module.exports = ValidatorProcess;

