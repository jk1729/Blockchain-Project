/**
 * PDSChain Phase 10: Crash Recovery & Journal Quarantine Test Suite
 */

const fs = require('fs');
const path = require('path');
const ConsensusJournal = require('../src/consensus/ConsensusJournal');
const CheckpointManager = require('../src/blockchain/sync/CheckpointManager');
const LedgerCheckpoint = require('../src/blockchain/sync/LedgerCheckpoint');
const { SyncStatus, LedgerSyncState } = require('../src/blockchain/sync/LedgerSyncState');
const LedgerRecoveryManager = require('../src/blockchain/sync/LedgerRecoveryManager');
const Blockchain = require('../src/blockchain/Blockchain');
const Block = require('../src/blockchain/Block');

describe('PHASE 10: Crash Recovery & Consensus Journal Replay', () => {
  const testDir = path.resolve(__dirname, 'test-sync-recovery');
  const journalFile = path.join(testDir, 'consensus_journal.jsonl');
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

  beforeEach(() => {
    // Clean up testDir files
    if (fs.existsSync(journalFile)) fs.unlinkSync(journalFile);
    if (fs.existsSync(checkpointFile)) fs.unlinkSync(checkpointFile);
  });

  describe('1. ConsensusJournal Corrupt Quarantine & Replay', () => {
    test('1.1 should detect malformed/truncated journal record and quarantine to .corrupt file', () => {
      const journal = new ConsensusJournal({ filepath: journalFile });
      journal.append('VOTE_RECORDED', { height: 1, round: 0, vote: 'ACCEPT' });
      journal.append('BLOCK_FINALIZED', { height: 1, round: 0 });

      // Append corrupt truncated JSON lines simulating crash mid-write
      fs.appendFileSync(journalFile, '{"sequence":3,"eventType":"VOTE_RECO\n', 'utf8');
      fs.appendFileSync(journalFile, 'MALFORMED_GARBAGE_LINE\n', 'utf8');

      // Recover state
      const recovery = journal.recoverState();
      expect(recovery.hasCorruptedRecords).toBe(true);
      expect(recovery.quarantinedPath).not.toBeNull();
      expect(fs.existsSync(recovery.quarantinedPath)).toBe(true);
      expect(recovery.entryCount).toBe(2);
      expect(recovery.finalizedHeights).toContain(1);

      // Verify the original journal was cleanly repaired without corrupt lines
      const repairedJournal = new ConsensusJournal({ filepath: journalFile });
      const secondRecovery = repairedJournal.recoverState();
      expect(secondRecovery.hasCorruptedRecords).toBe(false);
      expect(secondRecovery.entryCount).toBe(2);
    });

    test('1.2 should strictly distinguish unfinalized active rounds from finalized commitments', () => {
      const journal = new ConsensusJournal({ filepath: journalFile });
      journal.append('BLOCK_FINALIZED', { height: 1, round: 0 });
      journal.append('VOTE_RECORDED', { height: 2, round: 1, vote: 'ACCEPT' });
      journal.append('ROUND_CHANGE', { height: 2, round: 2 });

      const state = journal.recoverState();
      expect(state.finalizedHeights).toEqual([1]);
      expect(state.unfinalizedRounds.length).toBe(1);
      expect(state.unfinalizedRounds[0].height).toBe(2);
      expect(state.unfinalizedRounds[0].round).toBe(2);
    });
  });

  describe('2. LedgerRecoveryManager Crash Recovery & Reconciliation', () => {
    let blockchain;
    let syncState;
    let checkpointManager;
    let journal;

    beforeEach(() => {
      blockchain = new Blockchain();
      blockchain.getLatestBlock(); // genesis

      syncState = new LedgerSyncState({ validatorId: 'VAL-01' });
      checkpointManager = new CheckpointManager({ filepath: checkpointFile });
      journal = new ConsensusJournal({ filepath: journalFile });
    });

    test('2.1 should execute clean startup recovery and transition to CURRENT', async () => {
      const manager = new LedgerRecoveryManager({
        blockchain,
        journal,
        checkpointManager,
        syncState
      });

      const result = await manager.recover();
      expect(result.success).toBe(true);
      expect(result.state).toBe(SyncStatus.CURRENT);
      expect(syncState.isConsensusReady()).toBe(true);
      expect(checkpointManager.getLatestCheckpoint()).not.toBeNull();
      expect(checkpointManager.getLatestCheckpoint().blockHeight).toBe(0);
    });

    test('2.2 should recover and auto-create checkpoint after crash following block commit', async () => {
      // Add Block 1 to blockchain, but do NOT save checkpoint (simulates crash before checkpoint write)
      const b1 = blockchain.addBlock([], ['VAL-01'], '0xstate1');
      expect(checkpointManager.getLatestCheckpoint()).toBeNull();

      const manager = new LedgerRecoveryManager({
        blockchain,
        journal,
        checkpointManager,
        syncState
      });

      const result = await manager.recover();
      expect(result.success).toBe(true);
      expect(result.state).toBe(SyncStatus.CURRENT);

      // Checkpoint must now be automatically aligned with Block 1
      const cp = checkpointManager.getLatestCheckpoint();
      expect(cp).not.toBeNull();
      expect(cp.blockHeight).toBe(1);
      expect(cp.blockHash).toBe(b1.blockHash);
    });

    test('2.3 should enter HALTED when blockchain integrity is broken', async () => {
      // Tamper with Genesis block previousHash to break chain integrity
      blockchain.chain[0].blockHash = '0xtamperedhash0000000000000000000000000000000000000000000000000000';

      const manager = new LedgerRecoveryManager({
        blockchain,
        journal,
        checkpointManager,
        syncState
      });

      const result = await manager.recover();
      expect(result.success).toBe(false);
      expect(result.state).toBe(SyncStatus.HALTED);
      expect(syncState.isConsensusReady()).toBe(false);
      expect(syncState.isHalted()).toBe(true);
    });

    test('2.4 should enter RECOVERY_REQUIRED if checkpoint is ahead of block store', async () => {
      // Create a checkpoint at height 5 while local chain is only at 0
      const futureCp = new LedgerCheckpoint({
        blockHeight: 5,
        blockHash: '0xfuturehash00000000000000000000000000000000000000000000000000000000',
        verificationStatus: 'VERIFIED'
      });
      checkpointManager.saveCheckpoint(futureCp);

      const manager = new LedgerRecoveryManager({
        blockchain,
        journal,
        checkpointManager,
        syncState
      });

      const result = await manager.recover();
      expect(result.success).toBe(false);
      expect(result.state).toBe(SyncStatus.RECOVERY_REQUIRED);
      expect(syncState.isConsensusReady()).toBe(false);
    });

    test('2.5 should purge already-finalized transactions from mempool on recovery', async () => {
      // Mock mempool
      const mempoolTxs = new Map([
        ['tx-finalized', { id: 'tx-finalized', amount: 50 }],
        ['tx-pending', { id: 'tx-pending', amount: 100 }]
      ]);
      const mockMempool = {
        remove: (id) => mempoolTxs.delete(id)
      };

      // Add block containing tx-finalized
      blockchain.addBlock([{ transactionId: 'tx-finalized' }], ['VAL-01'], '0xstate1');

      const manager = new LedgerRecoveryManager({
        blockchain,
        journal,
        checkpointManager,
        syncState,
        mempool: mockMempool
      });

      const result = await manager.recover();
      expect(result.success).toBe(true);
      expect(mempoolTxs.has('tx-finalized')).toBe(false); // purged!
      expect(mempoolTxs.has('tx-pending')).toBe(true);    // preserved!
    });
  });
});

