/**
 * PDSChain Phase 10: Sync State Machine & Checkpointing Test Suite
 */

const fs = require('fs');
const path = require('path');
const { SyncStatus, LedgerSyncState } = require('../src/blockchain/sync/LedgerSyncState');
const LedgerCheckpoint = require('../src/blockchain/sync/LedgerCheckpoint');
const CheckpointManager = require('../src/blockchain/sync/CheckpointManager');
const Blockchain = require('../src/blockchain/Blockchain');
const Block = require('../src/blockchain/Block');

describe('PHASE 10: Ledger State Machine & Checkpointing', () => {
  const testDir = path.resolve(__dirname, 'test-sync-checkpoint');
  const checkpointFile = path.join(testDir, 'checkpoint.json');

  beforeAll(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  describe('1. LedgerSyncState State Machine', () => {
    let syncState;

    beforeEach(() => {
      syncState = new LedgerSyncState({ validatorId: 'VAL-01' });
    });

    test('1.1 should initialize in BOOTSTRAPPING state with consensus blocked', () => {
      expect(syncState.state).toBe(SyncStatus.BOOTSTRAPPING);
      expect(syncState.isConsensusReady()).toBe(false);
      expect(syncState.isSyncing()).toBe(false);
    });

    test('1.2 should allow valid state progression to CURRENT', () => {
      // BOOTSTRAPPING -> SYNCING
      syncState.transitionTo(SyncStatus.SYNCING, 'Discovered network target');
      expect(syncState.state).toBe(SyncStatus.SYNCING);
      expect(syncState.isSyncing()).toBe(true);
      expect(syncState.isConsensusReady()).toBe(false);

      // SYNCING -> VERIFYING
      syncState.transitionTo(SyncStatus.VERIFYING, 'All batches received');
      expect(syncState.state).toBe(SyncStatus.VERIFYING);
      expect(syncState.isConsensusReady()).toBe(false);

      // Setup valid verification invariants
      syncState.verificationStatus = 'PASSED';
      syncState.stateRootStatus = 'VALID';
      syncState.receiptRootStatus = 'VALID';
      syncState.setTargetHeight(10);
      syncState.setFinalizedState(10, '0xabcdef');

      // VERIFYING -> CURRENT
      syncState.transitionTo(SyncStatus.CURRENT, 'Ledger verified and current');
      expect(syncState.state).toBe(SyncStatus.CURRENT);
      expect(syncState.isConsensusReady()).toBe(true);
    });

    test('1.3 should reject illegal state transitions', () => {
      // BOOTSTRAPPING cannot transition directly to HALTED or invalid states without proper transition
      expect(() => {
        syncState.transitionTo('NON_EXISTENT_STATE');
      }).toThrow(/Invalid target sync state/);

      // SYNCING cannot transition straight to BOOTSTRAPPING
      syncState.transitionTo(SyncStatus.SYNCING);
      expect(() => {
        syncState.transitionTo(SyncStatus.BOOTSTRAPPING);
      }).toThrow(/Illegal state transition/);
    });

    test('1.4 should enforce invariants when transitioning to CURRENT', () => {
      syncState.transitionTo(SyncStatus.SYNCING);
      syncState.transitionTo(SyncStatus.VERIFYING);

      // Verification not passed yet
      syncState.verificationStatus = 'FAILED';
      expect(() => {
        syncState.transitionTo(SyncStatus.CURRENT);
      }).toThrow(/verificationStatus is 'FAILED'/);

      // Still behind target height
      syncState.verificationStatus = 'PASSED';
      syncState.setTargetHeight(20);
      syncState.setFinalizedState(10, '0xabc');
      expect(() => {
        syncState.transitionTo(SyncStatus.CURRENT);
      }).toThrow(/is behind target/);
    });

    test('1.5 should accurately track peer heights and sync progress', () => {
      syncState.setPeerHeight('VAL-02', 15);
      syncState.setPeerHeight('VAL-03', 20);
      expect(syncState.getPeerHeight('VAL-02')).toBe(15);
      expect(syncState.getPeerHeight('VAL-03')).toBe(20);

      syncState.startSyncBatch(1, 10, 20);
      expect(syncState.getProgressPercentage()).toBe(0);

      syncState.setFinalizedState(15, '0x15');
      expect(syncState.getProgressPercentage()).toBe(50);

      syncState.setFinalizedState(20, '0x20');
      expect(syncState.getProgressPercentage()).toBe(100);
    });

    test('1.6 should capture snapshot telemetry correctly', () => {
      syncState.setFinalizedState(5, '0xhash5');
      syncState.recordSyncSuccess();
      const snapshot = syncState.getSnapshot();

      expect(snapshot.validatorId).toBe('VAL-01');
      expect(snapshot.localFinalizedHeight).toBe(5);
      expect(snapshot.latestBlockHash).toBe('0xhash5');
      expect(snapshot.lastSuccessfulSyncAt).not.toBeNull();
      expect(snapshot.retriesCount).toBe(0);
    });
  });

  describe('2. LedgerCheckpoint & CheckpointManager', () => {
    let blockchain;
    let genesisBlock;

    beforeAll(() => {
      blockchain = new Blockchain();
      genesisBlock = blockchain.getLatestBlock();
    });

    test('2.1 should construct valid checkpoint from finalized Genesis block', () => {
      const cp = LedgerCheckpoint.fromFinalizedBlock(genesisBlock, 1);
      expect(cp.blockHeight).toBe(0);
      expect(cp.blockHash).toBe(genesisBlock.blockHash);
      expect(cp.verificationStatus).toBe('VERIFIED');
      expect(cp.checkpointHash).toBeDefined();

      const verifyResult = cp.verifyAgainstBlock(genesisBlock);
      expect(verifyResult.valid).toBe(true);
    });

    test('2.2 should detect tampered block data in verifyAgainstBlock', () => {
      const cp = LedgerCheckpoint.fromFinalizedBlock(genesisBlock, 1);
      const tamperedBlock = {
        ...genesisBlock.toJSON(),
        blockHash: 'badhash0000000000000000000000000000000000000000000000000000000000'
      };

      const verifyResult = cp.verifyAgainstBlock(tamperedBlock);
      expect(verifyResult.valid).toBe(false);
      expect(verifyResult.reason).toMatch(/Block hash mismatch/);
    });

    test('2.3 CheckpointManager should atomically persist and reload checkpoint', () => {
      const manager = new CheckpointManager({ filepath: checkpointFile });
      const cp0 = LedgerCheckpoint.fromFinalizedBlock(genesisBlock, 1);

      manager.saveCheckpoint(cp0);
      expect(fs.existsSync(checkpointFile)).toBe(true);

      // Re-load in a fresh manager
      const manager2 = new CheckpointManager({ filepath: checkpointFile });
      const loaded = manager2.getLatestCheckpoint();
      expect(loaded).not.toBeNull();
      expect(loaded.blockHeight).toBe(0);
      expect(loaded.blockHash).toBe(genesisBlock.blockHash);
      expect(loaded.checkpointHash).toBe(cp0.checkpointHash);
    });

    test('2.4 CheckpointManager should reject stale checkpoints', () => {
      const manager = new CheckpointManager({ filepath: checkpointFile });
      // Add a block to chain
      const b1 = blockchain.addBlock([], ['VAL-01'], '0xstate1');
      const cp1 = LedgerCheckpoint.fromFinalizedBlock(b1, 2);
      manager.saveCheckpoint(cp1);

      // Try to re-save older checkpoint cp0 (height 0)
      const cp0 = LedgerCheckpoint.fromFinalizedBlock(genesisBlock, 1);
      expect(() => {
        manager.saveCheckpoint(cp0);
      }).toThrow(/Stale checkpoint rejected/);
    });

    test('2.5 CheckpointManager should detect conflicting checkpoints at same height', () => {
      const manager = new CheckpointManager({ inMemoryOnly: true });
      const cpA = new LedgerCheckpoint({
        blockHeight: 5,
        blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        previousHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        verificationStatus: 'VERIFIED'
      });
      manager.saveCheckpoint(cpA);

      const cpB = new LedgerCheckpoint({
        blockHeight: 5,
        blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        previousHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        verificationStatus: 'VERIFIED'
      });

      expect(() => {
        manager.saveCheckpoint(cpB);
      }).toThrow(/Conflicting checkpoint detected at height #5/);
    });

    test('2.6 CheckpointManager should detect conflicting peer checkpoint', () => {
      const manager = new CheckpointManager({ inMemoryOnly: true });
      const localCp = new LedgerCheckpoint({
        blockHeight: 10,
        blockHash: '0x1010101010101010101010101010101010101010101010101010101010101010',
        verificationStatus: 'VERIFIED'
      });
      manager.saveCheckpoint(localCp);

      const matchingPeer = { blockHeight: 10, blockHash: '0x1010101010101010101010101010101010101010101010101010101010101010' };
      const resMatch = manager.compareWithPeer(matchingPeer);
      expect(resMatch.match).toBe(true);
      expect(resMatch.conflict).toBe(false);

      const conflictingPeer = { blockHeight: 10, blockHash: '0x9999999999999999999999999999999999999999999999999999999999999999' };
      const resConflict = manager.compareWithPeer(conflictingPeer);
      expect(resConflict.match).toBe(false);
      expect(resConflict.conflict).toBe(true);
      expect(resConflict.reason).toMatch(/Conflicting block hash/);
    });

    test('2.7 CheckpointManager should clean up leftover .tmp files on crash recovery', () => {
      const tmpFile = `${checkpointFile}.tmp`;
      fs.writeFileSync(tmpFile, 'partial write corruption...', 'utf8');
      expect(fs.existsSync(tmpFile)).toBe(true);

      // Initializing manager should detect and clean up the tmp file
      new CheckpointManager({ filepath: checkpointFile });
      expect(fs.existsSync(tmpFile)).toBe(false);
    });
  });
});

