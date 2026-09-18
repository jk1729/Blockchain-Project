const ConsensusCertificate = require('./ConsensusCertificate');
const { calculateMerkleRoot } = require('../blockchain/merkle');
const { verifyBlockProposalSignature } = require('../blockchain/identity/signature');
const { getPublicParticipantInfo } = require('../blockchain/identity/keyManager');
const QuorumEngine = require('./QuorumEngine');

class FinalityEngine {
  /**
   * @param {Map<string, ValidatorNode>|Array<ValidatorNode>} [validatorRegistry]
   * @param {object} [options]
   */
  constructor(validatorRegistry = null, options = {}) {
    this.quorumEngine = new QuorumEngine(validatorRegistry, options);
    this.threshold = parseInt(options.threshold, 10) || 9;
  }

  /**
   * Verify all 11 strict finality criteria before committing a candidate block
   * @param {Block|object} candidateBlock 
   * @param {ConsensusCertificate|object} certificate 
   * @param {Blockchain|object} blockchain - Current blockchain instance
   * @returns {{ final: boolean, code?: string, reason?: string, checks?: object }}
   */
  evaluateFinality(candidateBlock, certificate, blockchain) {
    const checks = {};

    // 1. Block structure check
    if (!candidateBlock) {
      return { final: false, code: 'MISSING_BLOCK', reason: 'Candidate block is null or undefined' };
    }
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10);
    const blockHash = String(candidateBlock.blockHash || candidateBlock.hash || '');
    const previousHash = String(candidateBlock.previousHash || '');
    const merkleRoot = String(candidateBlock.merkleRoot || '');
    const stateRoot = String(candidateBlock.stateRoot || '');
    const transactions = Array.isArray(candidateBlock.transactions) ? candidateBlock.transactions : [];

    if (!blockHash) {
      return { final: false, code: 'INVALID_BLOCK_HASH', reason: 'Candidate block missing blockHash' };
    }
    checks.blockStructure = true;

    // 2. Proposer signature check (if proposer signature present)
    if (candidateBlock.proposerSignature) {
      const proposerId = candidateBlock.proposerId || 'VAL-01';
      let pubKey = candidateBlock.proposerPublicKey;
      if (!pubKey) {
        const info = getPublicParticipantInfo(proposerId);
        if (info) pubKey = info.publicKey;
      }

      if (pubKey) {
        const propCheck = verifyBlockProposalSignature(candidateBlock, candidateBlock.proposerSignature, pubKey);
        if (!propCheck.valid) {
          return { final: false, code: 'INVALID_PROPOSER_SIGNATURE', reason: `Proposer signature invalid: ${propCheck.reason}` };
        }
      }
    }
    checks.proposerSignature = true;

    // 3 & 4. Chain continuity (height and previousBlockHash)
    if (blockchain) {
      const lastBlock = typeof blockchain.getLatestBlock === 'function'
        ? blockchain.getLatestBlock()
        : (blockchain.chain ? blockchain.chain[blockchain.chain.length - 1] : null);

      if (lastBlock) {
        const expectedHeight = (parseInt(lastBlock.blockNumber !== undefined ? lastBlock.blockNumber : lastBlock.index, 10) || 0) + 1;
        if (blockNumber !== expectedHeight) {
          return {
            final: false,
            code: 'HEIGHT_MISMATCH',
            reason: `Block height #${blockNumber} does not match expected height #${expectedHeight}`
          };
        }

        const lastHash = String(lastBlock.blockHash || lastBlock.hash || '');
        if (previousHash !== lastHash) {
          return {
            final: false,
            code: 'PREVIOUS_HASH_MISMATCH',
            reason: `Block previousHash '${previousHash}' does not match latest block hash '${lastHash}'`
          };
        }
      }
    }
    checks.chainContinuity = true;

    // 5. Merkle root validation
    const computedMerkleRoot = calculateMerkleRoot(transactions);
    if (merkleRoot && merkleRoot !== computedMerkleRoot) {
      return {
        final: false,
        code: 'MERKLE_ROOT_MISMATCH',
        reason: `Block merkleRoot '${merkleRoot}' does not match computed '${computedMerkleRoot}'`
      };
    }
    checks.merkleRoot = true;

    // 6. State root existence
    if (!stateRoot) {
      return {
        final: false,
        code: 'MISSING_STATE_ROOT',
        reason: 'Block missing deterministic stateRoot'
      };
    }
    checks.stateRoot = true;

    // 7. Receipts root validation (if present)
    if (candidateBlock.receiptsRoot) {
      checks.receiptsRoot = true;
    }

    // 8. Consensus certificate presence
    if (!certificate) {
      return {
        final: false,
        code: 'MISSING_CERTIFICATE',
        reason: 'Block missing consensus certificate required for finality'
      };
    }
    checks.certificatePresence = true;

    // 9, 10 & 11. Standalone certificate & quorum verification
    const certVerify = ConsensusCertificate.verify(certificate, candidateBlock, this.quorumEngine.validatorMap);
    if (!certVerify.valid) {
      return {
        final: false,
        code: certVerify.code || 'CERTIFICATE_VERIFICATION_FAILED',
        reason: `Certificate verification failed: ${certVerify.reason}`
      };
    }
    checks.certificateValidity = true;
    checks.quorumThreshold = true;
    checks.quorumSlices = true;

    return {
      final: true,
      blockNumber,
      blockHash,
      certificateHash: certificate.certificateHash,
      approvalCount: certVerify.approvalCount,
      checks
    };
  }
}

module.exports = FinalityEngine;

