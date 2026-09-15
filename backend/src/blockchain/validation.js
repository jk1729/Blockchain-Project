/**
 * Blockchain Validation Module
 * Enforces cryptographic block integrity, Merkle root consistency,
 * proposer signature authenticity, sequential hash-linking, and
 * consensus certificate verification across the ledger.
 */

const { calculateMerkleRoot } = require('./merkle');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');

function validateBlock(block, previousBlock) {
  if (!block) return { valid: false, reason: 'Block is null or undefined' };

  if (typeof block.isValid === 'function') {
    if (!block.isValid()) {
      return { valid: false, reason: `Block #${block.blockNumber} hash or Merkle root does not match contents` };
    }
  } else {
    // If raw object
    const computedMerkle = calculateMerkleRoot(block.transactions || []);
    if (block.merkleRoot && block.merkleRoot !== computedMerkle) {
      return { valid: false, reason: `Block #${block.blockNumber} Merkle root mismatch` };
    }
  }

  // Validate Proposer Signature if present
  if (block.proposerSignature && typeof block.verifyProposerSignature === 'function') {
    const propCheck = block.verifyProposerSignature();
    if (!propCheck.valid) {
      return { valid: false, reason: `Block #${block.blockNumber} proposer signature invalid: ${propCheck.reason}` };
    }
  }

  if (previousBlock) {
    if (block.blockNumber !== previousBlock.blockNumber + 1) {
      return { valid: false, reason: `Block #${block.blockNumber} sequence broken: expected ${previousBlock.blockNumber + 1}` };
    }
    const prevBlockHash = previousBlock.blockHash || previousBlock.hash;
    if (block.previousHash !== prevBlockHash) {
      return { valid: false, reason: `Block #${block.blockNumber} previousHash does not match Block #${previousBlock.blockNumber} hash` };
    }
  } else {
    // Genesis block check
    if (block.blockNumber !== 0 && block.blockNumber !== 1) {
      // In PDSChain, block 0 is Genesis
      if (block.previousHash !== '0' && block.previousHash !== '0000000000000000000000000000000000000000000000000000000000000000') {
        return { valid: false, reason: `Genesis block has invalid previousHash: ${block.previousHash}` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate that a block's committed stateRoot matches an expected state root
 * @param {Block|object} block 
 * @param {string} expectedStateRoot 
 * @returns {{ valid: boolean, code?: string, reason?: string }}
 */
function validateBlockStateRoot(block, expectedStateRoot) {
  if (!block) return { valid: false, code: 'INVALID_BLOCK', reason: 'Block is null or undefined' };
  
  const blockRoot = String(block.stateRoot || '').toLowerCase().trim();
  const expRoot = String(expectedStateRoot || '').toLowerCase().trim();

  if (!blockRoot) {
    return { valid: false, code: 'STATE_ROOT_MISMATCH', reason: `Block #${block.blockNumber} is missing required stateRoot.` };
  }

  const match = (blockRoot === expRoot) || (blockRoot.replace(/^0x/, '') === expRoot.replace(/^0x/, ''));
  if (!match) {
    return {
      valid: false,
      code: 'STATE_ROOT_MISMATCH',
      reason: `Block #${block.blockNumber} state root mismatch: expected '${expectedStateRoot}', found '${block.stateRoot}'.`,
      expected: expectedStateRoot,
      actual: block.stateRoot
    };
  }

  return { valid: true };
}

/**
 * Validate that a block contains a cryptographically valid ConsensusCertificate
 * @param {Block|object} block 
 * @param {Map<string, ValidatorNode>|Array<ValidatorNode>} [validatorMap] 
 * @returns {{ valid: boolean, code?: string, reason?: string }}
 */
function validateBlockConsensusCertificate(block, validatorMap = null) {
  if (!block) return { valid: false, code: 'INVALID_BLOCK', reason: 'Block is null or undefined' };
  if (!block.consensusCertificate) {
    return { valid: false, code: 'MISSING_CONSENSUS_CERTIFICATE', reason: `Block #${block.blockNumber} is missing consensus certificate` };
  }

  return ConsensusCertificate.verify(block.consensusCertificate, block, validatorMap);
}

function validateChain(chain, options = {}) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return { isValid: false, reason: 'Chain is empty or not an array' };
  }

  // Validate genesis block
  const genesis = chain[0];
  const genesisCheck = validateBlock(genesis, null);
  if (!genesisCheck.valid) {
    return { isValid: false, reason: genesisCheck.reason };
  }

  // Validate consecutive blocks
  for (let i = 1; i < chain.length; i++) {
    const currentBlock = chain[i];
    const previousBlock = chain[i - 1];

    const result = validateBlock(currentBlock, previousBlock);
    if (!result.valid) {
      return { isValid: false, reason: result.reason, brokenBlockIndex: i };
    }

    if (options.verifyCertificates && currentBlock.consensusCertificate) {
      const certCheck = validateBlockConsensusCertificate(currentBlock, options.validatorMap);
      if (!certCheck.valid) {
        return { isValid: false, reason: `Block #${currentBlock.blockNumber} certificate invalid: ${certCheck.reason}`, brokenBlockIndex: i };
      }
    }
  }

  return { isValid: true, blockCount: chain.length };
}

module.exports = {
  validateBlock,
  validateBlockStateRoot,
  validateBlockConsensusCertificate,
  validateChain
};
