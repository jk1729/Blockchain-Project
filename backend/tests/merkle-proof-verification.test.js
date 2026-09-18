/**
 * Standalone Merkle Proof Verification Test Suite (Phase 16 - Stage K & Q)
 */

const {
  MerkleTree,
  verifyMerkleProof,
  verifyMerkleProofBatch,
  MERKLE_ERROR_CODES
} = require('../src/blockchain/merkle');
const BrowserVerifier = require('../../frontend/js/merkle-verifier');

describe('Standalone Merkle Proof Verification Test Suite', () => {
  let tree;
  let leaves;

  beforeAll(() => {
    leaves = [
      { transactionId: 'TX-VER-0', sender: 'BEN-0', receiver: 'FPS-1', commodity: 'Rice', quantity: 5 },
      { transactionId: 'TX-VER-1', sender: 'BEN-1', receiver: 'FPS-1', commodity: 'Wheat', quantity: 10 },
      { transactionId: 'TX-VER-2', sender: 'BEN-2', receiver: 'FPS-2', commodity: 'Sugar', quantity: 2 },
      { transactionId: 'TX-VER-3', sender: 'BEN-3', receiver: 'FPS-2', commodity: 'Oil', quantity: 1 }
    ];
    tree = new MerkleTree(leaves);
  });

  describe('1. Node.js Standalone Verifier', () => {
    test('should verify all valid proofs in balanced tree', () => {
      for (let i = 0; i < leaves.length; i++) {
        const proof = tree.getProof(i);
        const result = verifyMerkleProof(proof);

        expect(result.valid).toBe(true);
        expect(result.computedRoot).toBe(tree.getRoot());
        expect(result.reason).toBeNull();
      }
    });

    test('should fail when leaf is tampered', () => {
      const proof = tree.getProof(0);
      const tamperedProof = { ...proof.toJSON(), leafHash: 'a'.repeat(64) };

      const result = verifyMerkleProof(tamperedProof);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(MERKLE_ERROR_CODES.ROOT_MISMATCH);
    });

    test('should fail when sibling position is inverted', () => {
      const proof = tree.getProof(0);
      const json = proof.toJSON();
      json.siblings[0].position = 'left'; // Was right

      const result = verifyMerkleProof(json);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(MERKLE_ERROR_CODES.ROOT_MISMATCH);
    });

    test('should fail when expected root is incorrect', () => {
      const proof = tree.getProof(0);
      const result = verifyMerkleProof(proof, null, 'e'.repeat(64));
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(MERKLE_ERROR_CODES.ROOT_MISMATCH);
    });

    test('should verify batch proofs efficiently', () => {
      const p0 = tree.getProof(0);
      const p1 = tree.getProof(1);
      const p2 = tree.getProof(2);

      const batchResults = verifyMerkleProofBatch([
        { proof: p0 },
        { proof: p1 },
        { proof: p2 }
      ]);

      expect(batchResults.length).toBe(3);
      expect(batchResults.every(r => r.valid)).toBe(true);
    });
  });

  describe('2. Browser-Compatible Standalone Verifier (frontend/js/merkle-verifier.js)', () => {
    test('should compute identical SHA-256 digests', () => {
      const crypto = require('crypto');
      const testInputs = ['hello world', 'PDSChain Merkle Verification', '1234567890abcdef'];

      for (const input of testInputs) {
        const nodeHash = crypto.createHash('sha256').update(input).digest('hex');
        const browserHash = BrowserVerifier.sha256(input);
        expect(browserHash).toBe(nodeHash);
      }
    });

    test('should verify valid proof identical to Node verifier', () => {
      for (let i = 0; i < leaves.length; i++) {
        const proof = tree.getProof(i).toJSON();
        const result = BrowserVerifier.verify(proof);

        expect(result.valid).toBe(true);
        expect(result.computedRoot).toBe(tree.getRoot());
        expect(result.reason).toBeNull();
      }
    });

    test('should detect tampered proofs and return ROOT_MISMATCH', () => {
      const proof = tree.getProof(1).toJSON();
      proof.siblings[0].hash = '0'.repeat(64);

      const result = BrowserVerifier.verify(proof);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ROOT_MISMATCH');
    });

    test('should detect malformed proof structure in browser verifier', () => {
      expect(BrowserVerifier.verify(null).valid).toBe(false);
      expect(BrowserVerifier.verify({ leafHash: 'invalid' }).valid).toBe(false);
    });
  });
});

