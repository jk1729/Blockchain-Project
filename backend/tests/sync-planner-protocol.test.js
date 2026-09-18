/**
 * PDSChain Phase 10: Sync Planner & Range Protocol Test Suite
 */

const { MessageEnvelope, MessageType } = require('../src/network/MessageEnvelope');
const { NetworkConfig, PeerManager, NetworkMetrics } = require('../src/network');
const SyncPlanner = require('../src/blockchain/sync/SyncPlanner');
const { SyncStatus, LedgerSyncState } = require('../src/blockchain/sync/LedgerSyncState');
const LedgerCheckpoint = require('../src/blockchain/sync/LedgerCheckpoint');
const CheckpointManager = require('../src/blockchain/sync/CheckpointManager');
const SyncHandler = require('../src/network/handlers/SyncHandler');
const DiscoveryHandler = require('../src/network/handlers/DiscoveryHandler');
const Blockchain = require('../src/blockchain/Blockchain');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../src/blockchain/identity/keyManager');
const { signValidatorVote } = require('../src/blockchain/identity/signature');

function createMockCertificate(block) {
  const allValidators = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09'];
  const approvals = allValidators.map(vId => {
    const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
    const privKey = getParticipantPrivateKey(vId);
    const votePayload = {
      chainId: 1729,
      validatorId: vId,
      validatorAddress: vPart.address,
      validatorPublicKey: vPart.publicKey,
      proposalId: block.proposalId || 'prop-sync-test',
      blockNumber: block.blockNumber,
      blockHash: block.blockHash,
      stateRoot: block.stateRoot || '',
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
    proposalId: block.proposalId || 'prop-sync-test',
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    stateRoot: block.stateRoot || '',
    round: 0,
    threshold: 9,
    totalValidators: 12,
    achieved: true,
    validatorApprovals: approvals
  });
  return cert.toJSON();
}

describe('PHASE 10: Sync Planner & Range Protocol Suite', () => {
  let blockchain;
  let syncState;
  let checkpointManager;
  let syncPlanner;
  let config;

  beforeEach(() => {
    blockchain = new Blockchain();
    blockchain.getLatestBlock(); // init genesis

    syncState = new LedgerSyncState({ validatorId: 'VAL-01' });
    checkpointManager = new CheckpointManager({ inMemoryOnly: true });

    config = NetworkConfig.forValidator('VAL-01', {
      listenPort: 5001,
      networkId: 'pdschain-test'
    });

    syncPlanner = new SyncPlanner({
      config,
      blockchain,
      syncState,
      checkpointManager,
      defaultBatchSize: 20
    });
  });

  describe('1. SyncPlanner Multi-Peer Height Discovery & Agreement', () => {
    test('1.1 should require multi-peer agreement to establish target height', () => {
      // 3 peers report height 10, 1 rogue peer reports height 99
      const peerHeights = new Map([
        ['VAL-02', 10],
        ['VAL-03', 10],
        ['VAL-04', 10],
        ['VAL-05', 99]
      ]);

      const result = syncPlanner.determineTargetHeight(peerHeights, 2);
      expect(result.targetHeight).toBe(10);
      expect(result.agreementCount).toBe(3);
      expect(result.agreeingPeers).toContain('VAL-02');
      expect(result.agreeingPeers).not.toContain('VAL-05');
    });

    test('1.2 should fallback safely if only 1 peer is connected', () => {
      const peerHeights = new Map([['VAL-02', 15]]);
      const result = syncPlanner.determineTargetHeight(peerHeights, 2);
      expect(result.targetHeight).toBe(15);
      expect(result.agreementCount).toBe(1);
    });

    test('1.3 should correctly partition ranges into bounded batches', () => {
      const batches = syncPlanner.createBatches(1, 45, 20);
      expect(batches.length).toBe(3);

      expect(batches[0]).toEqual({ batchNumber: 1, fromHeight: 1, toHeight: 20, count: 20 });
      expect(batches[1]).toEqual({ batchNumber: 2, fromHeight: 21, toHeight: 40, count: 20 });
      expect(batches[2]).toEqual({ batchNumber: 3, fromHeight: 41, toHeight: 45, count: 5 });
    });

    test('1.4 should select and rotate peers on failure', () => {
      const peers = ['VAL-02', 'VAL-03', 'VAL-04'];
      expect(syncPlanner.selectSyncPeer(peers)).toBe('VAL-02');

      syncPlanner.recordPeerFailure('VAL-02');
      expect(syncPlanner.selectSyncPeer(peers)).toBe('VAL-03');

      syncPlanner.recordPeerFailure('VAL-03');
      expect(syncPlanner.selectSyncPeer(peers)).toBe('VAL-04');
    });

    test('1.5 should detect common finalized ancestor', () => {
      // Add 3 blocks locally
      const b1 = blockchain.addBlock([], ['VAL-01'], '0xstate1');
      const b2 = blockchain.addBlock([], ['VAL-01'], '0xstate2');
      const b3 = blockchain.addBlock([], ['VAL-01'], '0xstate3');

      // Peer has same block 1 and 2, but fork at block 3
      const peerBlocks = [
        { height: 3, blockHash: '0xforkhash3' },
        { height: 2, blockHash: b2.blockHash },
        { height: 1, blockHash: b1.blockHash }
      ];

      const ancestor = syncPlanner.detectCommonAncestor(peerBlocks);
      expect(ancestor.commonAncestorHeight).toBe(2);
      expect(ancestor.commonAncestorHash).toBe(b2.blockHash);
      expect(ancestor.diverged).toBe(false);
    });

    test('1.6 should detect hard chain divergence if Genesis differs', () => {
      const peerBlocks = [
        { height: 0, blockHash: '0xdifferentgenesis0000000000000000000000000000000000000000000000000' }
      ];

      const ancestor = syncPlanner.detectCommonAncestor(peerBlocks);
      expect(ancestor.diverged).toBe(true);
      expect(ancestor.commonAncestorHeight).toBe(-1);
    });
  });

  describe('2. DiscoveryHandler & SyncHandler Range Requests', () => {
    let discoveryHandler;
    let syncHandler;
    let mockPeerConn;
    let sentMessages;

    beforeEach(() => {
      sentMessages = [];
      mockPeerConn = {
        peerValidatorId: 'VAL-02',
        send: (msg) => sentMessages.push(msg)
      };

      discoveryHandler = new DiscoveryHandler({
        config,
        blockchain,
        checkpointManager
      });

      syncHandler = new SyncHandler({
        config,
        blockchain,
        peerManager: { sendTo: (id, env) => sentMessages.push(env) },
        syncState,
        checkpointManager
      });
    });

    test('2.1 DiscoveryHandler should answer HEIGHT_DISCOVERY_REQUEST', async () => {
      const req = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.HEIGHT_DISCOVERY_REQUEST,
        senderId: 'VAL-02'
      });

      await discoveryHandler.handleHeightDiscoveryRequest(req, mockPeerConn);
      expect(sentMessages.length).toBe(1);

      const resp = sentMessages[0];
      expect(resp.type).toBe(MessageType.HEIGHT_DISCOVERY_RESPONSE);
      expect(resp.payload.finalizedHeight).toBe(0);
      expect(resp.payload.latestBlockHash).toBe(blockchain.getLatestBlock().blockHash);
      expect(resp.correlationId).toBe(req.messageId);
    });

    test('2.2 DiscoveryHandler should answer ANCESTOR_REQUEST with local hashes', async () => {
      const b1 = blockchain.addBlock([], ['VAL-01'], '0xstate1');

      const req = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.ANCESTOR_REQUEST,
        senderId: 'VAL-02',
        payload: { heights: [0, 1, 2] }
      });

      await discoveryHandler.handleAncestorRequest(req, mockPeerConn);
      expect(sentMessages.length).toBe(1);

      const resp = sentMessages[0];
      expect(resp.type).toBe(MessageType.ANCESTOR_RESPONSE);
      expect(resp.payload.results.length).toBe(2); // 0 and 1 exist
      expect(resp.payload.results[0].height).toBe(0);
      expect(resp.payload.results[1].height).toBe(1);
    });

    test('2.3 SyncHandler should serve range requests with batch checksum', async () => {
      const b1 = blockchain.addBlock([], ['VAL-01'], '0xstate1');
      const b2 = blockchain.addBlock([], ['VAL-01'], '0xstate2');

      const req = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_REQUEST,
        senderId: 'VAL-02',
        payload: {
          fromHeight: 1,
          toHeight: 2,
          maxBlocks: 10
        }
      });

      await syncHandler.handleSyncRequest(req, mockPeerConn);
      expect(sentMessages.length).toBe(1);

      const resp = sentMessages[0];
      expect(resp.type).toBe(MessageType.SYNC_RESPONSE);
      expect(resp.payload.count).toBe(2);
      expect(resp.payload.batchChecksum).toBeDefined();
      expect(resp.payload.isEndOfRange).toBe(true);
      expect(resp.payload.blocks[0].blockNumber).toBe(1);
      expect(resp.payload.blocks[1].blockNumber).toBe(2);
    });

    test('2.4 SyncHandler should atomically apply valid synced batch and update checkpoint', async () => {
      // Create separate chain to generate verified blocks
      const sourceChain = new Blockchain();
      const b1 = sourceChain.addBlock([], ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09'], '0xstate1');
      b1.consensusCertificate = createMockCertificate(b1);

      // Receiver chain is at Genesis (height 0)
      expect(blockchain.getLatestBlock().blockNumber).toBe(0);

      const respEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: {
          fromHeight: 1,
          toHeight: 1,
          count: 1,
          blocks: [b1.toJSON()]
        }
      });

      const applied = await syncHandler.handleSyncResponse(respEnv, mockPeerConn);
      expect(applied).toBe(1);
      expect(blockchain.getLatestBlock().blockNumber).toBe(1);
      expect(blockchain.getLatestBlock().blockHash).toBe(b1.blockHash);

      // Verify checkpoint was updated
      const latestCp = checkpointManager.getLatestCheckpoint();
      expect(latestCp).not.toBeNull();
      expect(latestCp.blockHeight).toBe(1);
      expect(latestCp.blockHash).toBe(b1.blockHash);
    });

    test('2.5 SyncHandler should reject batch with tampered batchChecksum', async () => {
      const sourceChain = new Blockchain();
      const b1 = sourceChain.addBlock([], ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09'], '0xstate1');
      b1.consensusCertificate = createMockCertificate(b1);

      const respEnv = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: {
          fromHeight: 1,
          toHeight: 1,
          count: 1,
          batchChecksum: 'tampered_checksum_00000000000000000000000000000000000000000000000000',
          blocks: [b1.toJSON()]
        }
      });

      await expect(syncHandler.handleSyncResponse(respEnv, mockPeerConn)).rejects.toThrow(/Batch checksum mismatch/);
      expect(blockchain.getLatestBlock().blockNumber).toBe(0); // Atomicity: nothing committed
    });
  });
});
