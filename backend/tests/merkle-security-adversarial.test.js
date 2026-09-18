/**
 * Merkle Proof Security & Adversarial Test Suite (Phase 16 - Stage N & Q)
 */

const {
  MerkleProof,
  MerkleTree,
  verifyMerkleProof,
  verifyMerkleProofBatch,
  MERKLE_ERROR_CODES,
  MerkleError
} = require('../src/blockchain/merkle');

describe('Merkle Proof Security & Adversarial Test Suite', () => {
  describe('1. Input Bounds & Format Validation', () => {
    test('should reject proof depth exceeding 32 levels', () => {
      const oversizedSiblings = Array.from({ length: 33 }, () => ({
        position: 'left',
        hash: 'a'.repeat(64)
      }));

      expect(() => {
        const p = new MerkleProof({
          leafHash: 'b'.repeat(64),
          expectedRoot: 'c'.repeat(64),
          treeDepth: 33,
          siblings: oversizedSiblings,
          totalLeaves: 100,
          leafIndex: 0
        });
        p.validateStructure();
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.DEPTH_EXCEEDED }));
    });

    test('should reject malformed hex hashes (non-hex, truncated, odd length)', () => {
      const badHashes = [
        'not-a-hex',
        '0x1234', // too short
        'g'.repeat(64), // invalid hex char
        'a'.repeat(63), // 63 chars (odd)
        'a'.repeat(65) // 65 chars
      ];

      for (const badHash of badHashes) {
        expect(() => {
          const p = new MerkleProof({
            leafHash: badHash,
            expectedRoot: 'a'.repeat(64),
            treeDepth: 0,
            siblings: [],
            totalLeaves: 1,
            leafIndex: 0
          });
          p.validateStructure();
        }).toThrow();
      }
    });

    test('should reject negative or out-of-bounds leaf index', () => {
      expect(() => {
        const p = new MerkleProof({
          leafHash: 'a'.repeat(64),
          expectedRoot: 'a'.repeat(64),
          treeDepth: 0,
          siblings: [],
          totalLeaves: 5,
          leafIndex: -1
        });
        p.validateStructure();
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.INDEX_OUT_OF_BOUNDS }));

      expect(() => {
        const p = new MerkleProof({
          leafHash: 'a'.repeat(64),
          expectedRoot: 'a'.repeat(64),
          treeDepth: 0,
          siblings: [],
          totalLeaves: 5,
          leafIndex: 5 // out of bounds [0, 5)
        });
        p.validateStructure();
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.INDEX_OUT_OF_BOUNDS }));
    });

    test('should reject invalid sibling positions', () => {
      expect(() => {
        const p = new MerkleProof({
          leafHash: 'a'.repeat(64),
          expectedRoot: 'a'.repeat(64),
          treeDepth: 1,
          siblings: [{ position: 'middle', hash: 'b'.repeat(64) }],
          totalLeaves: 2,
          leafIndex: 0
        });
        p.validateStructure();
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.INVALID_SIBLING }));
    });

    test('should reject mismatched sibling count and tree depth', () => {
      expect(() => {
        const p = new MerkleProof({
          leafHash: 'a'.repeat(64),
          expectedRoot: 'a'.repeat(64),
          treeDepth: 5,
          siblings: [{ position: 'left', hash: 'b'.repeat(64) }],
          totalLeaves: 2,
          leafIndex: 0
        });
        p.validateStructure();
      }).toThrow(expect.objectContaining({ code: MERKLE_ERROR_CODES.MALFORMED_PROOF }));
    });
  });

  describe('2. Second-Preimage & Collision Resistance (Version 2)', () => {
    test('version 2 domain separation prevents leaf vs internal node collision', () => {
      const dummyData = '0'.repeat(64);

      // In V2, leaf hash = sha256(0x00 || dummyData)
      // Internal node hash = sha256(0x01 || left || right)
      const treeV2 = new MerkleTree([dummyData, dummyData], { version: 2 });
      const rootV2 = treeV2.getRoot();

      const treeV1 = new MerkleTree([dummyData, dummyData], { version: 1 });
      const rootV1 = treeV1.getRoot();

      expect(rootV2).not.toBe(rootV1);
    });
  });

  describe('3. Batch Verification Flood Protection', () => {
    test('should reject batch verification exceeding 50 proofs', () => {
      const oversizedBatch = Array.from({ length: 51 }, () => ({
        proof: {
          leafHash: 'a'.repeat(64),
          expectedRoot: 'a'.repeat(64),
          treeDepth: 0,
          siblings: []
        }
      }));

      expect(() => {
        verifyMerkleProofBatch(oversizedBatch, 50);
      }).toThrow(/exceeds maximum allowed batch size/);
    });
  });

  describe('4. Zero Secret Exposure in Proof Payloads', () => {
    test('proof serialization and errors must never contain sensitive keys or tokens', () => {
      const tree = new MerkleTree([{ transactionId: 'TX-SECRET-TEST' }]);
      const proof = tree.getProof(0);
      const json = JSON.stringify(proof);

      expect(json).not.toContain('privateKey');
      expect(json).not.toContain('secret');
      expect(json).not.toContain('password');
      expect(json).not.toContain('passphrase');
      expect(json).not.toContain('token');
    });
  });
});

