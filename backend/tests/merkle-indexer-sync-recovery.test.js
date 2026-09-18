/**
 * Merkle Indexer, Sync, and Recovery Integration Test Suite (Phase 16 - Stage M & Q)
 */

const { ProofIndexer, MerkleTree, MERKLE_ERROR_CODES } = require('../src/blockchain/merkle');
const LedgerRecoveryManager = require('../src/blockchain/sync/LedgerRecoveryManager');
const { LedgerSyncState } = require('../src/blockchain/sync/LedgerSyncState');
const Transaction = require('../src/blockchain/Transaction');

describe('Merkle Indexer, Sync & Recovery Test Suite', () => {
  let mockBlockchain;
  let mockSyncState;
  let proofIndexer;

  beforeEach(() => {
    proofIndexer = new ProofIndexer();
    mockSyncState = new LedgerSyncState();

    const tx1 = new Transaction({ transactionId: 'TX-SYNC-1', sender: 'BEN-1', receiver: 'FPS-1', payload: { commodity: 'Rice', quantity: 5 } });
    const tx2 = new Transaction({ transactionId: 'TX-SYNC-2', sender: 'BEN-2', receiver: 'FPS-1', payload: { commodity: 'Wheat', quantity: 10 } });

    const tree = new MerkleTree([tx1, tx2]);

    mockBlockchain = {
      chain: [
        {
          blockNumber: 0,
          blockHash: '0x' + '0'.repeat(64),
          transactions: [],
          merkleRoot: new MerkleTree([]).getRoot(),
          consensusStatus: 'FINALIZED',
          version: 1
        },
        {
          blockNumber: 1,
          blockHash: '0x' + '1'.repeat(64),
          transactions: [tx1.toBlockPayload(), tx2.toBlockPayload()],
          merkleRoot: tree.getRoot(),
          consensusStatus: 'FINALIZED',
          version: 1
        }
      ],
      getLatestBlock: () => mockBlockchain.chain[mockBlockchain.chain.length - 1],
      isChainValid: () => true
    };
  });

  describe('1. Recovery Lifecycle Integration', () => {
    test('should rebuild proofIndexer upon successful ledger recovery', async () => {
      const recoveryManager = new LedgerRecoveryManager({
        blockchain: mockBlockchain,
        syncState: mockSyncState,
        proofIndexer: proofIndexer
      });

      const res = await recoveryManager.recover();
      expect(res.success).toBe(true);
      expect(proofIndexer.isReady()).toBe(true);
      expect(proofIndexer.getTransactionRecord('TX-SYNC-1')).toBeDefined();
    });

    test('should mark proofIndexer DEGRADED if chain integrity fails', async () => {
      mockBlockchain.isChainValid = () => false;

      const recoveryManager = new LedgerRecoveryManager({
        blockchain: mockBlockchain,
        syncState: mockSyncState,
        proofIndexer: proofIndexer
      });

      const res = await recoveryManager.recover();
      expect(res.success).toBe(false);
      expect(proofIndexer.status).toBe('DEGRADED');
    });

    test('should reject proof generation when indexer status is REBUILDING', () => {
      proofIndexer.setStatus('REBUILDING');

      expect(() => {
        proofIndexer.generateTransactionProof('TX-SYNC-1', mockBlockchain);
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.RECOVERY_REQUIRED }));
    });
  });

  describe('2. Multi-Process Merkle Convergence', () => {
    test('multiple independent nodes must generate bit-for-bit identical proofs', () => {
      const txs = [
        { transactionId: 'TX-MULTI-1' },
        { transactionId: 'TX-MULTI-2' },
        { transactionId: 'TX-MULTI-3' }
      ];

      const metadata = {
        blockHeight: 10,
        blockHash: '0x' + 'a'.repeat(64),
        timestamp: '2026-09-17T22:00:00.000Z',
        requestId: 'req-fixed-test'
      };

      // Simulate Node 1
      const tree1 = new MerkleTree(txs);
      const proof1 = tree1.getProof(1, metadata);

      // Simulate Node 2
      const tree2 = new MerkleTree(txs);
      const proof2 = tree2.getProof(1, metadata);

      expect(proof1.leafHash).toBe(proof2.leafHash);
      expect(proof1.expectedRoot).toBe(proof2.expectedRoot);
      expect(proof1.siblings).toEqual(proof2.siblings);
      expect(JSON.stringify(proof1.toJSON())).toBe(JSON.stringify(proof2.toJSON()));
    });
  });
});
