/**
 * Merkle Core Tree Test Suite (Phase 16 - Stage C & Q)
 */

const crypto = require('crypto');
const {
  MerkleTree,
  MerkleProof,
  MerkleError,
  calculateMerkleRoot,
  getMerkleTree,
  hashTransactionLeaf,
  hashReceiptLeaf,
  hashEventLeaf,
  verifyMerkleProof,
  CommitmentVersion,
  CommitmentType,
  MERKLE_ERROR_CODES
} = require('../src/blockchain/merkle');

describe('Merkle Core Tree & Commitment Test Suite', () => {
  describe('1. Basic Tree Construction & Roots', () => {
    test('should correctly build an empty tree', () => {
      const tree = new MerkleTree([]);
      expect(tree.getRoot()).toBeDefined();
      expect(tree.getRoot().length).toBe(64);
      expect(tree.getLeaves().length).toBe(1);
      expect(tree.getDepth()).toBe(0);

      // Verify legacy calculation matches
      expect(calculateMerkleRoot([])).toBe(tree.getRoot());
    });

    test('should build a single-leaf tree with depth 0', () => {
      const tx = { transactionId: 'TX-1', sender: 'BEN-1', receiver: 'FPS-1', commodity: 'Rice', quantity: 5 };
      const tree = new MerkleTree([tx]);
      
      const expectedLeafHash = hashTransactionLeaf(tx);
      expect(tree.getRoot()).toBe(expectedLeafHash);
      expect(tree.getLeaves()).toEqual([expectedLeafHash]);
      expect(tree.getDepth()).toBe(0);

      const proof = tree.getProof(0);
      expect(proof.siblings.length).toBe(0);
      const ver = proof.verify();
      expect(ver.valid).toBe(true);
    });

    test('should build a 2-leaf balanced tree', () => {
      const tx1 = { transactionId: 'TX-1', sender: 'BEN-1', receiver: 'FPS-1' };
      const tx2 = { transactionId: 'TX-2', sender: 'BEN-2', receiver: 'FPS-1' };
      const tree = new MerkleTree([tx1, tx2]);

      expect(tree.getLeaves().length).toBe(2);
      expect(tree.layers.length).toBe(2);
      expect(tree.getDepth()).toBe(1);

      const l0 = hashTransactionLeaf(tx1);
      const l1 = hashTransactionLeaf(tx2);
      const expectedRoot = crypto.createHash('sha256').update(l0 + l1).digest('hex');
      expect(tree.getRoot()).toBe(expectedRoot);

      // Proof for leaf 0
      const p0 = tree.getProof(0);
      expect(p0.siblings.length).toBe(1);
      expect(p0.siblings[0]).toEqual({ position: 'right', hash: l1 });
      expect(p0.verify().valid).toBe(true);

      // Proof for leaf 1
      const p1 = tree.getProof(1);
      expect(p1.siblings.length).toBe(1);
      expect(p1.siblings[0]).toEqual({ position: 'left', hash: l0 });
      expect(p1.verify().valid).toBe(true);
    });

    test('should handle odd leaf counts (3 leaves) with odd-node duplication', () => {
      const txs = [
        { transactionId: 'TX-1' },
        { transactionId: 'TX-2' },
        { transactionId: 'TX-3' }
      ];
      const tree = new MerkleTree(txs);
      expect(tree.getLeaves().length).toBe(3);
      expect(tree.layers.length).toBe(3); // layer 0: 3, layer 1: 2, layer 2: 1

      // Each leaf should generate a valid, independently verifiable proof
      for (let i = 0; i < txs.length; i++) {
        const proof = tree.getProof(i);
        expect(proof.leafIndex).toBe(i);
        expect(proof.totalLeaves).toBe(3);
        const ver = proof.verify();
        expect(ver.valid).toBe(true);
      }
    });

    test('should handle non-power-of-two leaf counts (5, 7 leaves)', () => {
      for (const count of [5, 7, 9, 13]) {
        const txs = Array.from({ length: count }, (_, i) => ({ transactionId: `TX-${i}` }));
        const tree = new MerkleTree(txs);

        expect(tree.getLeaves().length).toBe(count);
        for (let i = 0; i < count; i++) {
          const proof = tree.getProof(i);
          const ver = proof.verify();
          expect(ver.valid).toBe(true);
        }
      }
    });

    test('should handle large trees (100 leaves) deterministically', () => {
      const txs = Array.from({ length: 100 }, (_, i) => ({
        transactionId: `TX-LARGE-${i}`,
        sender: `BEN-${i % 10}`,
        receiver: 'FPS-01',
        commodity: 'Wheat',
        quantity: i + 1,
        timestamp: '2026-09-17T22:00:00Z'
      }));

      const tree = new MerkleTree(txs);
      expect(tree.getLeaves().length).toBe(100);

      // Verify proofs for first, middle, and last leaf
      const pFirst = tree.getProof(0);
      expect(pFirst.verify().valid).toBe(true);

      const pMid = tree.getProof(49);
      expect(pMid.verify().valid).toBe(true);

      const pLast = tree.getProof(99);
      expect(pLast.verify().valid).toBe(true);
    });

    test('should handle duplicate leaves without colliding or corrupting path', () => {
      const tx = { transactionId: 'TX-DUP' };
      const tree = new MerkleTree([tx, tx, tx, tx]);
      expect(tree.getLeaves().length).toBe(4);

      for (let i = 0; i < 4; i++) {
        const proof = tree.getProof(i);
        expect(proof.verify().valid).toBe(true);
      }
    });
  });

  describe('2. Version 1 vs Version 2 Commitment Domains', () => {
    test('Version 1 should use raw concatenation', () => {
      const tx1 = { transactionId: 'TX-A' };
      const tx2 = { transactionId: 'TX-B' };

      const treeV1 = new MerkleTree([tx1, tx2], { version: 1 });
      const l0 = hashTransactionLeaf(tx1, 1);
      const l1 = hashTransactionLeaf(tx2, 1);
      const expectedV1 = crypto.createHash('sha256').update(l0 + l1).digest('hex');

      expect(treeV1.getRoot()).toBe(expectedV1);
    });

    test('Version 2 should use domain tags 0x00 and 0x01', () => {
      const tx1 = { transactionId: 'TX-A' };
      const tx2 = { transactionId: 'TX-B' };

      const treeV2 = new MerkleTree([tx1, tx2], { version: 2 });
      const rootV2 = treeV2.getRoot();

      const treeV1 = new MerkleTree([tx1, tx2], { version: 1 });
      const rootV1 = treeV1.getRoot();

      // V1 and V2 roots must be distinctly different due to domain tags
      expect(rootV2).not.toBe(rootV1);

      // Verification of V2 proof
      const pV2 = treeV2.getProof(0);
      expect(pV2.version).toBe(2);
      expect(pV2.verify().valid).toBe(true);
    });
  });

  describe('3. Receipt and Event Leaf Hashing', () => {
    test('should hash receipt leaves deterministically', () => {
      const receipt = {
        transactionId: 'TX-REC-1',
        contractAddress: '0x1234567890abcdef1234567890abcdef12345678',
        receiptHash: '0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff',
        status: 'SUCCESS',
        gasUsed: 21000
      };

      const tree = new MerkleTree([receipt], { commitmentType: CommitmentType.RECEIPT });
      expect(tree.getRoot()).toBeDefined();

      const proof = tree.getProof(0);
      expect(proof.commitmentType).toBe('RECEIPT');
      expect(proof.verify().valid).toBe(true);
    });

    test('should hash event leaves deterministically', () => {
      const event = {
        eventId: 'EVT-001',
        blockHeight: 10,
        transactionHash: '0xabc',
        logIndex: 0,
        contractAddress: '0x123',
        rawTopics: ['0xtopic1'],
        rawData: '0xdata'
      };

      const tree = new MerkleTree([event], { commitmentType: CommitmentType.EVENT });
      const proof = tree.getProof(0);
      expect(proof.commitmentType).toBe('EVENT');
      expect(proof.verify().valid).toBe(true);
    });
  });

  describe('4. Proof Serialization & Error Validation', () => {
    test('should roundtrip proof serialization via JSON', () => {
      const txs = [{ transactionId: 'TX-1' }, { transactionId: 'TX-2' }, { transactionId: 'TX-3' }];
      const tree = new MerkleTree(txs);
      const proof = tree.getProof(1, { blockHeight: 5, blockHash: '0x' + 'a'.repeat(64) });

      const json = proof.toJSON();
      const reconstructed = MerkleProof.fromJSON(json);

      expect(reconstructed.leafHash).toBe(proof.leafHash);
      expect(reconstructed.expectedRoot).toBe(proof.expectedRoot);
      expect(reconstructed.blockHeight).toBe(5);
      expect(reconstructed.verify().valid).toBe(true);
    });

    test('should reject malformed proof JSON', () => {
      expect(() => MerkleProof.fromJSON(null)).toThrow(MerkleError);
      expect(() => MerkleProof.fromJSON({ version: 99 })).toThrow(MerkleError);
      expect(() => MerkleProof.fromJSON({
        version: 1,
        leafHash: 'invalid-hex',
        expectedRoot: 'a'.repeat(64),
        totalLeaves: 1,
        leafIndex: 0,
        treeDepth: 0,
        siblings: []
      })).toThrow(MerkleError);
    });

    test('should fail verification when sibling hash is tampered', () => {
      const txs = [{ transactionId: 'TX-1' }, { transactionId: 'TX-2' }];
      const tree = new MerkleTree(txs);
      const proof = tree.getProof(0);

      // Tamper with sibling
      proof.siblings[0].hash = 'f'.repeat(64);
      const res = proof.verify();
      expect(res.valid).toBe(false);
      expect(res.reason).toBe(MERKLE_ERROR_CODES.ROOT_MISMATCH);
    });

    test('should fail verification when expected root does not match', () => {
      const txs = [{ transactionId: 'TX-1' }, { transactionId: 'TX-2' }];
      const tree = new MerkleTree(txs);
      const proof = tree.getProof(0);

      const res = proof.verify(null, '0'.repeat(64));
      expect(res.valid).toBe(false);
      expect(res.reason).toBe(MERKLE_ERROR_CODES.ROOT_MISMATCH);
    });
  });
});
