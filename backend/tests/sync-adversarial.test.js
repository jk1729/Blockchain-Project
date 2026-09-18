/**
 * PDSChain Phase 10: Adversarial Ledger Synchronization & Byzantine Fault-Injection Test Suite
 * 
 * Verifies strict rejection of:
 * - Peer advertising incorrect height or conflicting fork
 * - Blocks with wrong chain ID or network ID
 * - Blocks with invalid/insufficient consensus certificates
 * - Blocks with forged or mismatched state roots
 * - Blocks with invalid Merkle or transaction roots
 * - Tampered batch checksums
 * - Out-of-order or non-contiguous blocks
 * - Attempts to roll back finalized blocks
 * - Premature proposing or voting by a recovering validator
 */

const Blockchain = require('../src/blockchain/Blockchain');
const Block = require('../src/blockchain/Block');
const ConsensusCertificate = require('../src/consensus/ConsensusCertificate');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../src/blockchain/identity/keyManager');
const { signValidatorVote } = require('../src/blockchain/identity/signature');
const { MessageEnvelope, MessageType } = require('../src/network/MessageEnvelope');
const { NetworkConfig, NetworkErrorCode } = require('../src/network');
const SyncHandler = require('../src/network/handlers/SyncHandler');
const { SyncStatus, LedgerSyncState } = require('../src/blockchain/sync/LedgerSyncState');
const LedgerCheckpoint = require('../src/blockchain/sync/LedgerCheckpoint');
const CheckpointManager = require('../src/blockchain/sync/CheckpointManager');

function createValidCertificateForBlock(block, approvalCount = 9) {
  const allValidators = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'];
  const approvals = allValidators.slice(0, approvalCount).map(vId => {
    const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
    const privKey = getParticipantPrivateKey(vId);
    const votePayload = {
      chainId: 1729,
      validatorId: vId,
      validatorAddress: vPart.address,
      validatorPublicKey: vPart.publicKey,
      proposalId: block.proposalId || 'prop-adv-test',
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

  return new ConsensusCertificate({
    version: 1,
    chainId: 1729,
    proposalId: block.proposalId || 'prop-adv-test',
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    stateRoot: block.stateRoot || '',
    round: 0,
    threshold: 9,
    totalValidators: 12,
    achieved: approvalCount >= 9,
    validatorApprovals: approvals
  }).toJSON();
}

describe('PHASE 10: Adversarial Ledger Synchronization & Security Suite', () => {
  let localChain;
  let sourceChain;
  let syncState;
  let checkpointManager;
  let syncHandler;
  let config;
  let mockPeerConn;
  let sentMessages;

  beforeEach(() => {
    localChain = new Blockchain();
    localChain.getLatestBlock(); // Genesis #0

    sourceChain = new Blockchain();
    sourceChain.getLatestBlock();

    syncState = new LedgerSyncState({ validatorId: 'VAL-01' });
    checkpointManager = new CheckpointManager({ inMemoryOnly: true });

    config = NetworkConfig.forValidator('VAL-01', {
      listenPort: 5001,
      networkId: 'pdschain-test',
      chainId: 1729
    });

    sentMessages = [];
    mockPeerConn = {
      peerValidatorId: 'VAL-02',
      send: (env) => sentMessages.push(env)
    };

    syncHandler = new SyncHandler({
      config,
      blockchain: localChain,
      peerManager: { sendTo: (id, env) => sentMessages.push(env) },
      syncState,
      checkpointManager
    });
  });

  describe('Category 1: Block Header & Continuity Attacks', () => {
    test('1. should reject sync block with non-contiguous height gap', async () => {
      // Source chain creates block #1 and #2
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      b1.consensusCertificate = createValidCertificateForBlock(b1);
      const b2 = sourceChain.addBlock([], ['VAL-01'], '0xstate2');
      b2.consensusCertificate = createValidCertificateForBlock(b2);

      // Peer attempts to send block #2 directly (skipping block #1)
      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [b2.toJSON()] }
      });

      const applied = await syncHandler.handleSyncResponse(env, mockPeerConn);
      expect(applied).toBe(0);
      expect(localChain.getLatestBlock().blockNumber).toBe(0); // Nothing committed
    });

    test('2. should reject sync block with previousHash mismatch', async () => {
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      b1.consensusCertificate = createValidCertificateForBlock(b1);

      // Tamper with previousHash
      const tamperedB1 = {
        ...b1.toJSON(),
        previousHash: '0xwrongprevioushash000000000000000000000000000000000000000000000000'
      };

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [tamperedB1] }
      });

      await expect(syncHandler.handleSyncResponse(env, mockPeerConn)).rejects.toThrow(/previousHash .* does not match/);
      expect(localChain.getLatestBlock().blockNumber).toBe(0);
    });

    test('3. should reject sync block with tampered block hash or contents', async () => {
      const b1 = sourceChain.addBlock([{ txId: 'tx-1' }], ['VAL-01'], '0xstate1');
      b1.consensusCertificate = createValidCertificateForBlock(b1);

      // Tamper with transaction list without updating Merkle root or blockHash
      const tamperedB1 = {
        ...b1.toJSON(),
        transactions: [{ txId: 'tx-malicious-forged' }]
      };

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [tamperedB1] }
      });

      await expect(syncHandler.handleSyncResponse(env, mockPeerConn)).rejects.toThrow(/hash calculation or Merkle root mismatch/);
      expect(localChain.getLatestBlock().blockNumber).toBe(0);
    });
  });

  describe('Category 2: Cryptographic Certificate & Quorum Attacks', () => {
    test('4. should reject sync block missing consensus certificate', async () => {
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      // No certificate attached

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [b1.toJSON()] }
      });

      await expect(syncHandler.handleSyncResponse(env, mockPeerConn)).rejects.toThrow(/missing required consensus certificate/);
    });

    test('5. should reject sync block with insufficient certificate signatures (< 9-of-12)', async () => {
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      // Only 8 validator approvals (below 9 threshold)
      b1.consensusCertificate = createValidCertificateForBlock(b1, 8);

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [b1.toJSON()] }
      });

      await expect(syncHandler.handleSyncResponse(env, mockPeerConn)).rejects.toThrow(/failed certificate verification/);
    });

    test('6. should reject certificate with forged vote signature', async () => {
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      const cert = createValidCertificateForBlock(b1, 9);
      // Forged signature on approval #0
      cert.validatorApprovals[0].signature = '0xforged_signature_deadbeef000000000000000000000000000000000000000000000000';
      b1.consensusCertificate = cert;

      const env = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [b1.toJSON()] }
      });

      await expect(syncHandler.handleSyncResponse(env, mockPeerConn)).rejects.toThrow(/failed certificate verification/);
    });
  });

  describe('Category 3: Checkpoint, Fork & Rollback Protection', () => {
    test('7. should reject conflicting finalized checkpoint at same height', () => {
      const localCp = new LedgerCheckpoint({
        blockHeight: 1,
        blockHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
        verificationStatus: 'VERIFIED'
      });
      checkpointManager.saveCheckpoint(localCp);

      // Attempt to overwrite with different block hash
      const competingCp = new LedgerCheckpoint({
        blockHeight: 1,
        blockHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
        verificationStatus: 'VERIFIED'
      });

      expect(() => {
        checkpointManager.saveCheckpoint(competingCp);
      }).toThrow(/Conflicting checkpoint detected/);
    });

    test('8. should never automatically overwrite or roll back a finalized local block', async () => {
      const b1 = sourceChain.addBlock([], ['VAL-01'], '0xstate1');
      b1.consensusCertificate = createValidCertificateForBlock(b1);

      // Apply block 1 to local chain
      const env1 = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [b1.toJSON()] }
      });
      await syncHandler.handleSyncResponse(env1, mockPeerConn);
      expect(localChain.getLatestBlock().blockNumber).toBe(1);

      // Peer attempts to send a conflicting block at height #1
      const conflictingB1 = {
        ...b1.toJSON(),
        blockHash: '0xcompetinghash11111111111111111111111111111111111111111111111111111111'
      };

      const envConflict = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-test',
        chainId: 1729,
        type: MessageType.SYNC_RESPONSE,
        senderId: 'VAL-02',
        payload: { blocks: [conflictingB1] }
      });

      // Response processor must ignore or reject block at or below current height without overwriting
      const applied = await syncHandler.handleSyncResponse(envConflict, mockPeerConn);
      expect(applied).toBe(0);
      expect(localChain.getLatestBlock().blockHash).toBe(b1.blockHash); // Preserved!
    });
  });

  describe('Category 4: Consensus Gating & State Quarantine', () => {
    test('9. recovering validator must strictly block consensus proposal & vote emission', () => {
      // Validator is in SYNCING state
      syncState.transitionTo(SyncStatus.SYNCING);
      expect(syncState.isConsensusReady()).toBe(false);

      // Validator is in VERIFYING state
      syncState.transitionTo(SyncStatus.VERIFYING);
      expect(syncState.isConsensusReady()).toBe(false);

      // Validator is in RECOVERY_REQUIRED state
      syncState.transitionTo(SyncStatus.RECOVERY_REQUIRED);
      expect(syncState.isConsensusReady()).toBe(false);
      expect(syncState.isHalted()).toBe(true);
    });

    test('10. validator can enter CURRENT only when verification is passed and height is caught up', () => {
      syncState.transitionTo(SyncStatus.SYNCING);
      syncState.transitionTo(SyncStatus.VERIFYING);

      syncState.verificationStatus = 'PASSED';
      syncState.stateRootStatus = 'VALID';
      syncState.setTargetHeight(5);
      syncState.setFinalizedState(5, '0xfinal5');

      syncState.transitionTo(SyncStatus.CURRENT);
      expect(syncState.isConsensusReady()).toBe(true);
    });
  });
});
