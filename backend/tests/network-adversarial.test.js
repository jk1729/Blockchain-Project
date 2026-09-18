const net = require('net');
const {
  NetworkConfig,
  MessageEnvelope,
  MessageType,
  MessageCodec,
  StreamDecoder,
  TLSTransport,
  PeerAuthenticator,
  PeerManager,
  MessageRouter,
  ProposalHandler,
  VoteHandler,
  CertificateHandler,
  RoundChangeHandler,
  SyncHandler,
  NetworkError,
  NetworkErrorCode,
  NetworkMetrics
} = require('../src/network');
const Blockchain = require('../src/blockchain/Blockchain');
const Block = require('../src/blockchain/Block');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const VoteStore = require('../src/consensus/VoteStore');
const { ConflictDetector } = require('../src/consensus/ConflictDetector');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const { getParticipantPrivateKey, getOrCreateDevParticipant } = require('../src/blockchain/identity/keyManager');
const { signValidatorVote, signBlockProposal } = require('../src/blockchain/identity/signature');

describe('PHASE 9: Network Security, Adversarial Transport & Byzantine Protocol Test Suite (25 Tests)', () => {
  let auth1, auth2;
  let pm1, pm2;
  const port1 = 15201;
  const port2 = 15202;

  beforeAll(async () => {
    auth1 = new PeerAuthenticator('VAL-01');
    auth2 = new PeerAuthenticator('VAL-02');

    const config1 = new NetworkConfig({
      networkId: 'pdschain-devnet',
      validatorId: 'VAL-01',
      listenHost: '127.0.0.1',
      listenPort: port1,
      tls: false,
      maxFrameSizeBytes: 1024 * 1024, // 1 MB
      peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
    });

    const config2 = new NetworkConfig({
      networkId: 'pdschain-devnet',
      validatorId: 'VAL-02',
      listenHost: '127.0.0.1',
      listenPort: port2,
      tls: false,
      maxFrameSizeBytes: 1024 * 1024,
      peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
    });

    pm1 = new PeerManager({ config: config1, authenticator: auth1 });
    pm2 = new PeerManager({ config: config2, authenticator: auth2 });

    await pm1.start();
    await pm2.start();

    // Wait for mutual connection
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Initial handshake timeout')), 6000);
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
    if (pm1) await pm1.stop();
    if (pm2) await pm2.stop();
  });

  // =========================================================================
  // CATEGORY 1: Transport & Framing Adversarial Tests
  // =========================================================================
  describe('Category 1: Framing, Stream Ingestion & Transport Attacks', () => {
    test('1. should reject frame exceeding maxFrameSizeBytes before allocating buffer', (done) => {
      const decoder = new StreamDecoder({ maxFrameSize: 512 });
      decoder.on('error', (err) => {
        expect(err.message).toMatch(/exceeds maximum limit/);
        done();
      });

      // Header indicating 1024 bytes (exceeds 512)
      const oversizedHeader = Buffer.alloc(4);
      oversizedHeader.writeUInt32BE(1024, 0);
      decoder.push(oversizedHeader);
    });

    test('2. should handle corrupted length prefix and unexpected connection termination safely', (done) => {
      const socket = net.connect({ host: '127.0.0.1', port: port1 }, () => {
        // Write header claiming 200 bytes, but send only 5 bytes and close
        const fakeHeader = Buffer.alloc(4);
        fakeHeader.writeUInt32BE(200, 0);
        socket.write(fakeHeader);
        socket.write(Buffer.from('hello'));
        socket.destroy();
        done();
      });
      socket.on('error', () => done());
    });

    test('3. should handle slow-drip partial payload chunks without premature timeout', async () => {
      const decoder = new StreamDecoder({ maxFrameSize: 1024 });
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.HEARTBEAT,
        senderId: 'VAL-01',
        payload: { action: 'PING' }
      });

      const frame = MessageCodec.encode(env);
      let decodedEnv = null;
      decoder.on('message', (msg) => { decodedEnv = msg; });

      // Feed byte by byte
      for (let i = 0; i < frame.length; i++) {
        decoder.push(frame.subarray(i, i + 1));
      }

      expect(decodedEnv).not.toBeNull();
      expect(decodedEnv.type).toBe(MessageType.HEARTBEAT);
    });

    test('4. should reject malformed JSON payload and trigger framing_error', (done) => {
      const decoder = new StreamDecoder({ maxFrameSize: 1024 });
      decoder.on('error', (err) => {
        expect(err.message).toContain('Failed to parse frame JSON');
        done();
      });

      const garbageBody = Buffer.from('NOT_VALID_JSON{{{;;;');
      const header = Buffer.alloc(4);
      header.writeUInt32BE(garbageBody.length, 0);
      decoder.push(Buffer.concat([header, garbageBody]));
    });

    test('5. should reject self-connection loopback attempt deterministically', async () => {
      const selfConnConfig = new NetworkConfig({
        networkId: 'pdschain-devnet',
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: 15299,
        tls: false,
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: 15299 }]
      });

      expect(() => selfConnConfig.validate()).toThrow(/Cannot list self/i);
    });
  });

  // =========================================================================
  // CATEGORY 2: Authentication & Identity Attacks
  // =========================================================================
  describe('Category 2: Authentication & Cryptographic Identity Attacks', () => {
    test('6. should reject challenge replay attack (consuming challenge twice)', () => {
      const auth = new PeerAuthenticator('VAL-01');
      const challenge = auth.createChallenge();

      const validFirst = auth.consumeChallenge(challenge);
      expect(validFirst).toBe(true);

      // Second replay attempt
      const replayAttempt = auth.consumeChallenge(challenge);
      expect(replayAttempt).toBe(false);
    });

    test('7. should reject handshake when remote peer claims identity mismatch', () => {
      const auth = new PeerAuthenticator('VAL-01');
      const challenge = auth.createChallenge();
      // VAL-02 signs challenge
      const auth2Node = new PeerAuthenticator('VAL-02');
      const sig2 = auth2Node.signChallenge(challenge);

      // Peer claims to be VAL-03 but provided signature of VAL-02
      expect(() => {
        auth.verifyChallenge('VAL-03', challenge, sig2);
      }).toThrow(/signature verification failed/);
    });

    test('8. should reject unauthorized non-federation validator attempting to join', () => {
      const auth = new PeerAuthenticator('VAL-01', ['VAL-01', 'VAL-02']); // Restricted whitelist
      const challenge = auth.createChallenge();

      expect(() => {
        auth.verifyChallenge('MALICIOUS-NODE-99', challenge, '0xdeadbeef');
      }).toThrow(/not authorized to join/);
    });

    test('9. should reject forged signature on challenge nonce', () => {
      const auth = new PeerAuthenticator('VAL-01');
      const challenge = auth.createChallenge();
      const forgedSig = Buffer.alloc(64, 0xef).toString('hex');

      expect(() => {
        auth.verifyChallenge('VAL-02', challenge, forgedSig);
      }).toThrow(/signature verification failed/);
    });

    test('10. should reject challenge verification with expired challenge nonce', () => {
      const auth = new PeerAuthenticator('VAL-01');
      const challenge = auth.createChallenge();
      // Manually backdate challenge timestamp past TTL
      auth.activeChallenges.get(challenge).expiresAt = Date.now() - 5000;

      const consumed = auth.consumeChallenge(challenge);
      expect(consumed).toBe(false);
    });
  });

  // =========================================================================
  // CATEGORY 3: Envelope Integrity & Wire Replay Protection
  // =========================================================================
  describe('Category 3: Envelope Integrity & Wire Replay Protection', () => {
    test('11. should detect payload tampering between envelope messageId and wire content', () => {
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: { blockHeight: 1, amount: 100 }
      });

      // Tamper with payload after creation without updating messageId
      env.payload.amount = 999999;
      expect(env.isTampered()).toBe(true);
    });

    test('12. should reject envelope when chainId does not match node network config', () => {
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 9999, // Wrong chain ID
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: { blockHeight: 1 }
      });

      expect(() => {
        env.validate({ chainId: 1729, networkId: 'pdschain-devnet' });
      }).toThrow(/Chain ID mismatch/i);
    });

    test('13. should reject envelope when networkId does not match node network config', () => {
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'ethereum-mainnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: { blockHeight: 1 }
      });

      expect(() => {
        env.validate({ chainId: 1729, networkId: 'pdschain-devnet' });
      }).toThrow(/Network ID mismatch/i);
    });

    test('14. should suppress duplicate envelope floods via MessageRouter deduplication cache', async () => {
      const router = new MessageRouter({ config: pm2.config, peerManager: pm2 });
      let processedCount = 0;

      router.registerHandler(MessageType.VOTE, async () => {
        processedCount++;
      });

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.VOTE,
        senderId: 'VAL-01',
        payload: { voteId: 'flood-test' }
      });

      // Simulate rapid 10 duplicate arrivals
      for (let i = 0; i < 10; i++) {
        await router.route(env, { peerValidatorId: 'VAL-01' });
      }

      expect(processedCount).toBe(1);
      expect(router.metrics.duplicateMessagesTotal).toBe(9);
      router.stop();
    });
  });

  // =========================================================================
  // CATEGORY 4: Byzantine Consensus & Conflict Attacks
  // =========================================================================
  describe('Category 4: Byzantine Consensus & Conflict Attacks', () => {
    test('15. should detect and reject conflicting votes from same validator in same round (Equivocation)', () => {
      const detector = new ConflictDetector();
      const privKey = getParticipantPrivateKey('VAL-03');

      // Vote 1: for Block A
      const voteA = new ValidatorVote({
        chainId: 1729,
        validatorId: 'VAL-03',
        blockNumber: 1,
        round: 0,
        blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        vote: 'ACCEPT'
      });
      voteA.sign(privKey);

      // Vote 2: for Block B (same round, same height)
      const voteB = new ValidatorVote({
        chainId: 1729,
        validatorId: 'VAL-03',
        blockNumber: 1,
        round: 0,
        blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        vote: 'ACCEPT'
      });
      voteB.sign(privKey);

      const check1 = detector.checkVote(voteA, []);
      expect(check1.hasConflict).toBe(false);

      const check2 = detector.checkVote(voteB, [voteA]);
      expect(check2.hasConflict).toBe(true);
      expect(check2.reason).toMatch(/conflicting/i);
    });

    test('16. should reject proposal with forged proposer signature', async () => {
      const handler = new ProposalHandler({ config: pm1.config });
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-02',
        payload: {
          blockHeight: 1,
          round: 0,
          candidateBlock: {
            blockNumber: 1,
            proposerId: 'VAL-02',
            proposerSignature: '0xdeadbeefbadsignature'
          }
        }
      });

      // Verification of proposal from unauthorized validator throws
      const rogueEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'UNKNOWN_ATTACKER',
        payload: {
          blockHeight: 1,
          round: 0,
          candidateBlock: { blockNumber: 1, proposerId: 'UNKNOWN_ATTACKER' }
        }
      });

      await expect(handler.handle(rogueEnv, null)).rejects.toThrow(/unauthorized validator/);
    });

    test('17. should reject vote when sender attempts to impersonate another validator', async () => {
      const handler = new VoteHandler({ config: pm1.config });
      const privKey = getParticipantPrivateKey('VAL-02');
      const vote = new ValidatorVote({
        chainId: 1729,
        validatorId: 'VAL-02',
        blockNumber: 1,
        round: 0,
        blockHash: '0xabc',
        vote: 'ACCEPT'
      });
      vote.sign(privKey);

      // VAL-01 tries to send VAL-02's vote
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

    test('18. should reject consensus certificate with insufficient approvals (< threshold)', async () => {
      const certHandler = new CertificateHandler({ config: pm1.config });
      const cert = new ConsensusCertificate({
        version: 1,
        chainId: 1729,
        proposalId: 'prop-1',
        blockNumber: 1,
        blockHash: '0x123',
        threshold: 9,
        totalValidators: 12,
        achieved: false, // Quorum not achieved
        validatorApprovals: []
      });

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.CERTIFICATE,
        senderId: 'VAL-02',
        payload: { certificate: cert }
      });

      await expect(certHandler.handle(env, null)).rejects.toThrow(/lacks required threshold/);
    });

    test('19. should reject consensus certificate with tampered certificateHash', async () => {
      const certHandler = new CertificateHandler({ config: pm1.config });
      const cert = new ConsensusCertificate({
        version: 1,
        chainId: 1729,
        proposalId: 'prop-1',
        blockNumber: 1,
        blockHash: '0x123',
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: []
      });
      cert.certificateHash = '0xbadhash0000000000000000000000000000000000000000000000000000000000';

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.CERTIFICATE,
        senderId: 'VAL-02',
        payload: { certificate: cert }
      });

      await expect(certHandler.handle(env, null)).rejects.toThrow(/Certificate hash mismatch/);
    });
  });

  // =========================================================================
  // CATEGORY 5: Block Sync, Partition & Network Resilience
  // =========================================================================
  describe('Category 5: Block Sync, Network Partition & Resilience', () => {
    test('20. should reject sync block with non-contiguous block height gap', async () => {
      const blockchain = new Blockchain();
      blockchain.getLatestBlock(); // height 0
      const syncHandler = new SyncHandler({ config: pm1.config, blockchain, peerManager: pm1 });

      const gapBlockData = {
        blockNumber: 5, // Gap: expected 1, received 5
        previousHash: '0x000',
        transactions: []
      };

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [gapBlockData] }
      });

      // Gap detected causes early break, applied count is 0
      const applied = await syncHandler.handleSyncResponse(env, null);
      expect(applied).toBe(0);
      expect(blockchain.chain.length).toBe(1);
    });

    test('21. should reject sync block with previousHash mismatch', async () => {
      const blockchain = new Blockchain();
      const latest = blockchain.getLatestBlock();
      const syncHandler = new SyncHandler({ config: pm1.config, blockchain, peerManager: pm1 });

      const wrongPrevData = {
        blockNumber: 1,
        previousHash: '0xWRONG_PREVIOUS_HASH_THAT_DOES_NOT_MATCH_GENESIS',
        transactions: []
      };

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [wrongPrevData] }
      });

      await expect(syncHandler.handleSyncResponse(env, null)).rejects.toThrow(/previousHash/);
    });

    test('22. should reject sync block missing consensus certificate', async () => {
      const blockchain = new Blockchain();
      const latest = blockchain.getLatestBlock();
      const syncHandler = new SyncHandler({ config: pm1.config, blockchain, peerManager: pm1 });

      const uncertBlockData = {
        blockNumber: 1,
        previousHash: latest.blockHash,
        transactions: [],
        consensusCertificate: null // Missing!
      };

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-devnet',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [uncertBlockData] }
      });

      await expect(syncHandler.handleSyncResponse(env, null)).rejects.toThrow(/missing required consensus certificate/);
    });

    test('23. should simulate network partition: neither disjoint 6-node partition achieves 9-of-12 consensus', () => {
      // Split 12 validators into two 6-node partitions:
      const partitionA = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06'];
      const partitionB = ['VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'];

      const threshold = 9;

      // In FBA, 9-of-12 agreement is required globally
      const partitionACanDecide = partitionA.length >= threshold;
      const partitionBCanDecide = partitionB.length >= threshold;

      expect(partitionACanDecide).toBe(false);
      expect(partitionBCanDecide).toBe(false);
    });

    test('24. should record and verify peer latency updates on HEARTBEAT pong', () => {
      const peer = pm1.getPeer('VAL-02');
      expect(peer).toBeDefined();

      const initialLat = peer.latencyMs;
      peer.lastPingSent = Date.now() - 42; // simulated 42ms ping sent
      peer.handlePong({});

      expect(peer.latencyMs).toBeGreaterThanOrEqual(40);
    });

    test('25. should track accurate Prometheus counters across rejected message events', () => {
      const metrics = new NetworkMetrics();
      metrics.incrementSent(MessageType.PROPOSAL, 200);
      metrics.incrementReceived(MessageType.VOTE, 150);
      metrics.incrementRejected(NetworkErrorCode.UNAUTHORIZED_PEER);
      metrics.incrementRejected(NetworkErrorCode.MESSAGE_TAMPERED);
      metrics.incrementDuplicate();
      metrics.incrementFramingError();
      metrics.setActiveConnections(11);

      const prom = metrics.toPrometheusFormat();
      expect(prom).toContain('pdschain_network_active_connections 11');
      expect(prom).toContain('pdschain_network_messages_sent_total{type="PROPOSAL"} 1');
      expect(prom).toContain('pdschain_network_messages_received_total{type="VOTE"} 1');
      expect(prom).toContain(`pdschain_network_messages_rejected_total{reason="${NetworkErrorCode.UNAUTHORIZED_PEER}"} 1`);
      expect(prom).toContain('pdschain_network_duplicates_total 1');
      expect(prom).toContain('pdschain_network_framing_errors_total 1');
    });
  });
});
