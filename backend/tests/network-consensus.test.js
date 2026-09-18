const {
  NetworkConfig,
  MessageEnvelope,
  MessageType,
  PeerAuthenticator,
  PeerManager,
  MessageRouter,
  ProposalHandler,
  VoteHandler,
  CertificateHandler,
  RoundChangeHandler,
  SyncHandler
} = require('../src/network');
const Blockchain = require('../src/blockchain/Blockchain');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const VoteStore = require('../src/consensus/VoteStore');
const { getParticipantPrivateKey, getOrCreateDevParticipant } = require('../src/blockchain/identity/keyManager');
const { signValidatorVote } = require('../src/blockchain/identity/signature');

describe('PHASE 9: Network Consensus Handlers & Message Routing Test Suite', () => {
  let auth1, auth2;
  let pm1, pm2;
  let router1, router2;
  const port1 = 15011;
  const port2 = 15012;

  beforeAll(async () => {
    auth1 = new PeerAuthenticator('VAL-01');
    auth2 = new PeerAuthenticator('VAL-02');

    const config1 = new NetworkConfig({
      networkId: 'pdschain-devnet',
      validatorId: 'VAL-01',
      listenHost: '127.0.0.1',
      listenPort: port1,
      tls: false,
      peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
    });

    const config2 = new NetworkConfig({
      networkId: 'pdschain-devnet',
      validatorId: 'VAL-02',
      listenHost: '127.0.0.1',
      listenPort: port2,
      tls: false,
      peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
    });

    pm1 = new PeerManager({ config: config1, authenticator: auth1 });
    pm2 = new PeerManager({ config: config2, authenticator: auth2 });

    router1 = new MessageRouter({ config: config1, peerManager: pm1 });
    router2 = new MessageRouter({ config: config2, peerManager: pm2 });

    await pm1.start();
    await pm2.start();

    // Wait for connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      const check = () => {
        if (pm1.isConnectedTo('VAL-02') && pm2.isConnectedTo('VAL-01')) {
          clearTimeout(timeout);
          resolve();
        }
      };
      pm1.on('peer_connected', check);
      pm2.on('peer_connected', check);
      check();
    });
  });

  afterAll(async () => {
    if (router1) router1.stop();
    if (router2) router2.stop();
    if (pm1) await pm1.stop();
    if (pm2) await pm2.stop();
  });

  // =========================================================================
  // 1. MessageRouter & Duplicate Suppression
  // =========================================================================
  describe('1. MessageRouter & Duplicate Suppression', () => {
    test('1. should route message and suppress duplicate deliveries of same messageId', async () => {
      let receiveCount = 0;

      router2.registerHandler(MessageType.PROPOSAL, async (envelope) => {
        receiveCount++;
      });

      const proposalEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: {
          blockHeight: 1,
          round: 0,
          candidateBlock: { proposerId: 'VAL-01', blockNumber: 1 }
        }
      });

      // Send once
      pm1.sendTo('VAL-02', proposalEnv);
      await new Promise(r => setTimeout(r, 60));

      expect(receiveCount).toBe(1);

      // Send exact duplicate
      pm1.sendTo('VAL-02', proposalEnv);
      await new Promise(r => setTimeout(r, 60));

      // Receive count should remain 1 due to router deduplication
      expect(receiveCount).toBe(1);
    });

    test('2. should support correlated request-response roundtrips', async () => {
      router2.registerHandler(MessageType.SYNC_REQUEST, async (envelope, peerConn) => {
        const responseEnv = new MessageEnvelope({
          version: 1,
          networkId: 'pdschain-devnet',
          chainId: 1729,
          type: MessageType.SYNC_RESPONSE,
          senderId: 'VAL-02',
          correlationId: envelope.messageId,
          payload: { ack: true }
        });
        peerConn.send(responseEnv);
      });

      const requestEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.SYNC_REQUEST,
        senderId: 'VAL-01',
        payload: { fromHeight: 1 }
      });

      const response = await router1.requestResponse('VAL-02', requestEnv, 3000);
      expect(response.type).toBe(MessageType.SYNC_RESPONSE);
      expect(response.correlationId).toBe(requestEnv.messageId);
      expect(response.payload.ack).toBe(true);
    });
  });

  // =========================================================================
  // 2. ProposalHandler Validation
  // =========================================================================
  describe('2. ProposalHandler', () => {
    test('3. should validate proposal and reject unauthorized proposer', async () => {
      const handler = new ProposalHandler({
        config: pm1.config,
        onProposal: jest.fn()
      });

      // Valid proposal
      const validEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-02',
        payload: {
          blockHeight: 5,
          round: 0,
          candidateBlock: { proposerId: 'VAL-02' }
        }
      });
      await expect(handler.handle(validEnv, null)).resolves.not.toThrow();

      // Unauthorized proposer
      const badEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'ROGUE-NODE',
        payload: {
          blockHeight: 5,
          round: 0,
          candidateBlock: { proposerId: 'ROGUE-NODE' }
        }
      });
      await expect(handler.handle(badEnv, null)).rejects.toThrow(/unauthorized validator/);
    });
  });

  // =========================================================================
  // 3. VoteHandler Cryptographic Verification
  // =========================================================================
  describe('3. VoteHandler', () => {
    test('4. should verify valid Ed25519 signed vote and reject sender impersonation', async () => {
      const voteStore = new VoteStore();
      const handler = new VoteHandler({
        config: pm1.config,
        voteStore
      });

      // Create genuine vote for VAL-02
      const vote = new ValidatorVote({
        validatorId: 'VAL-02',
        blockNumber: 1,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        proposalId: 'prop-1',
        round: 0,
        vote: 'ACCEPT'
      });
      const privKey2 = getParticipantPrivateKey('VAL-02');
      vote.sign(privKey2);

      // Valid envelope sent by VAL-02
      const validEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.VOTE,
        senderId: 'VAL-02',
        payload: { vote }
      });

      const res = await handler.handle(validEnv, null);
      expect(res.success).toBe(true);

      // Impersonation attack: VAL-01 envelope claiming vote of VAL-02
      const impersonationEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.VOTE,
        senderId: 'VAL-01',
        payload: { vote }
      });

      await expect(handler.handle(impersonationEnv, null)).rejects.toThrow(/impersonating vote/);
    });
  });

  // =========================================================================
  // 4. SyncHandler Block Synchronization
  // =========================================================================
  describe('4. SyncHandler', () => {
    test('5. should synchronize finalized blocks across nodes with certificate verification', async () => {
      const blockchain1 = new Blockchain();
      const blockchain2 = new Blockchain();

      // Ensure both have genesis
      blockchain1.getLatestBlock();
      blockchain2.getLatestBlock();

      // Add a block to blockchain1
      const addedBlock = blockchain1.addBlock([{ txId: 'tx-1', amount: 10 }]);

      const allValidators = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'];
      const approvals = allValidators.slice(0, 9).map(vId => {
        const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
        const privKey = getParticipantPrivateKey(vId);
        const votePayload = {
          chainId: 1729,
          validatorId: vId,
          validatorAddress: vPart.address,
          validatorPublicKey: vPart.publicKey,
          proposalId: addedBlock.proposalId || 'prop-test',
          blockNumber: addedBlock.blockNumber,
          blockHash: addedBlock.blockHash,
          stateRoot: addedBlock.stateRoot || '',
          round: 0,
          vote: 'ACCEPT',
          reason: ''
        };
        const signature = signValidatorVote(votePayload, privKey);
        return {
          validatorId: vId,
          validatorAddress: vPart.address,
          validatorPublicKey: vPart.publicKey,
          signature,
          timestamp: new Date().toISOString(),
          vote: 'ACCEPT'
        };
      });

      const cert = new ConsensusCertificate({
        version: 1,
        chainId: 1729,
        proposalId: addedBlock.proposalId || 'prop-test',
        blockNumber: addedBlock.blockNumber,
        blockHash: addedBlock.blockHash,
        stateRoot: addedBlock.stateRoot || '',
        round: 0,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });
      addedBlock.consensusCertificate = cert.toJSON();

      expect(blockchain1.chain.length).toBe(2);
      expect(blockchain2.chain.length).toBe(1);

      const syncHandler1 = new SyncHandler({
        config: pm1.config,
        blockchain: blockchain1,
        peerManager: pm1
      });

      const syncHandler2 = new SyncHandler({
        config: pm2.config,
        blockchain: blockchain2,
        peerManager: pm2
      });

      // Register sync handlers on routers
      router1.registerHandler(MessageType.SYNC_REQUEST, (env, conn) => syncHandler1.handleSyncRequest(env, conn));
      router2.registerHandler(MessageType.SYNC_RESPONSE, (env, conn) => syncHandler2.handleSyncResponse(env, conn));

      // Node 2 requests sync from Node 1
      const reqEnvelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.SYNC_REQUEST,
        senderId: 'VAL-02',
        payload: { fromHeight: 1, maxBlocks: 10 }
      });

      pm2.sendTo('VAL-01', reqEnvelope);

      // Wait for sync response and application
      await new Promise(r => setTimeout(r, 120));

      expect(blockchain2.chain.length).toBe(2);
      expect(blockchain2.getLatestBlock().blockHash).toBe(addedBlock.blockHash);
    });
  });
});
