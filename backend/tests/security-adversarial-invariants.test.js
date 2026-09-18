/**
 * Phase 17 Test Suite 9: Consensus, Ledger, Proof & Recovery Cryptographic Invariants
 */

const Block = require('../src/blockchain/Block');
const Blockchain = require('../src/blockchain/Blockchain');
const Transaction = require('../src/blockchain/Transaction');
const { validateBlock } = require('../src/blockchain/validation');
const { MerkleTree, verifyMerkleProof } = require('../src/blockchain/merkle');
const { defaultAuthorizationService } = require('../src/security/permissions');

describe('Phase 17: Cryptographic & Consensus Safety Invariants', () => {
  let blockchain;
  let adminUser;

  beforeEach(() => {
    blockchain = new Blockchain();
    adminUser = { id: 1, username: 'super_admin', role: 'SUPER_ADMIN' };
  });

  test('Invariant 1: Privileged Admin CANNOT bypass block Merkle root validation', () => {
    // Construct a block with forged Merkle root
    const tx = new Transaction({
      transactionId: 'TXN-INV-1',
      sender: 'BEN-01',
      receiver: 'FPS-01',
      payload: { commodity: 'Rice', quantity: 5 }
    });
    const forgedMerkleRoot = '0'.repeat(64);

    const badBlock = new Block(
      1,
      new Date().toISOString(),
      [tx],
      blockchain.getLatestBlock().blockHash,
      0,
      'FINALIZED',
      [],
      null,
      { merkleRoot: forgedMerkleRoot }
    );
    badBlock.merkleRoot = forgedMerkleRoot;

    // Direct block validation must fail
    const valResult = validateBlock(badBlock, blockchain.getLatestBlock());
    expect(valResult.valid).toBe(false);

    // If added to ledger, chain validation fails closed
    blockchain.chain.push(badBlock);
    expect(blockchain.isChainValid()).toBe(false);
  });

  test('Invariant 2: Standalone Merkle proof verification fails on forged sibling or leaf', () => {
    const leaves = [
      'a'.repeat(64),
      'b'.repeat(64),
      'c'.repeat(64),
      'd'.repeat(64)
    ];

    const tree = new MerkleTree(leaves);
    const proof = tree.getProof(1);
    expect(proof).toBeDefined();

    // Valid proof passes
    expect(verifyMerkleProof(proof).valid).toBe(true);

    // Tampered root fails closed
    const fakeRoot = 'f'.repeat(64);
    expect(verifyMerkleProof(proof, proof.leafHash, fakeRoot).valid).toBe(false);

    // Tampered sibling path fails closed
    const tamperedProof = JSON.parse(JSON.stringify(proof));
    if (tamperedProof.siblings && tamperedProof.siblings.length > 0) {
      tamperedProof.siblings[0] = { position: 'left', hash: 'e'.repeat(64) };
    }
    expect(verifyMerkleProof(tamperedProof).valid).toBe(false);
  });

  test('Invariant 3: Finalized block height cannot be mutated by recovery operations', () => {
    // Genesis block is height 0 and finalized
    const genesis = blockchain.getLatestBlock();
    expect(genesis.blockNumber).toBe(0);

    // Attempting to overwrite genesis block or mutate chain history invalidates ledger
    blockchain.chain[0].blockHash = 'tampered-hash-cannot-match-header';
    expect(blockchain.isChainValid()).toBe(false);
  });

  test('Invariant 4: Authorization check failure fails closed for sensitive actions', () => {
    // Calling evaluate with undefined or null parameters must always fail closed (DENY)
    const res = defaultAuthorizationService.evaluate({
      user: adminUser,
      permissionId: null
    });
    expect(res.allowed).toBe(false);
    expect(res.decision).toBe('DENY');
  });
});
