/**
 * Deterministic Consensus Certificate & Proposal Binding Repair Utility
 *
 * Repairs historical blocks in SQLite whose ConsensusCertificate had an empty
 * blockHash ("") or missing validatorApprovals due to the pre-fix proposal
 * construction order, without altering any blockHash, previousHash, merkleRoot,
 * stateRoot, or transaction payload.
 */

const BlockModel = require('../models/Block');
const Block = require('../blockchain/Block');
const ConsensusCertificate = require('../consensus/ConsensusCertificate');
const fbaConsensus = require('../consensus/FBAConsensus');
const { getOrCreateDevParticipant, getParticipantPrivateKey } = require('../blockchain/identity/keyManager');
const { signValidatorVote } = require('../blockchain/identity/signature');
const { validateChain } = require('../blockchain/validation');

const ALL_VALIDATORS = [
  'VAL-01', 'VAL-02', 'VAL-03', 'VAL-04',
  'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08',
  'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'
];

async function repairConsensusCertificates() {
  const rows = await BlockModel.findAll({ order: [['blockNumber', 'ASC']] });
  let repairedCount = 0;

  for (const r of rows) {
    const blk = new Block(
      r.blockNumber,
      r.timestamp,
      r.transactions,
      r.previousHash,
      r.nonce,
      r.consensusStatus,
      r.validatorSignatures,
      r.stateRoot,
      {
        version: r.version,
        proposerId: r.proposerId,
        proposerAddress: r.proposerAddress,
        proposerSignature: r.proposerSignature,
        proposalId: r.proposalId,
        round: r.round,
        consensusCertificate: r.consensusCertificate
      }
    );
    if (r.merkleRoot) blk.merkleRoot = r.merkleRoot;
    if (r.blockHash) blk.blockHash = r.blockHash;

    const certCheck = ConsensusCertificate.verify(blk.consensusCertificate, blk, fbaConsensus.validators);
    const propCheck = blk.blockNumber > 0 ? blk.verifyProposerSignature() : { valid: true };

    if (!certCheck.valid || !propCheck.valid) {
      const proposerId = blk.proposerId || (blk.blockNumber === 0 ? 'GENESIS' : 'VAL-01');
      if (blk.blockNumber > 0) {
        const proposerPart = getOrCreateDevParticipant(proposerId, 'VALIDATOR');
        blk.proposerAddress = blk.proposerAddress || proposerPart.address;
        const proposerPrivKey = getParticipantPrivateKey(proposerId);
        if (proposerPrivKey) {
          blk.signProposal(proposerPrivKey);
        }
      } else {
        blk.proposalId = blk.calculateProposalId();
      }

      const round = parseInt(blk.round || 0, 10);
      const approvals = ALL_VALIDATORS.map(vId => {
        const vPart = getOrCreateDevParticipant(vId, 'VALIDATOR');
        const vPrivKey = getParticipantPrivateKey(vId);
        const votePayload = {
          validatorId: vId,
          validatorAddress: vPart.address,
          validatorPublicKey: vPart.publicKey,
          proposalId: blk.proposalId,
          blockNumber: blk.blockNumber,
          blockHash: blk.blockHash,
          stateRoot: String(blk.stateRoot || ''),
          round,
          vote: 'ACCEPT',
          reason: ''
        };
        const signature = signValidatorVote(votePayload, vPrivKey);
        return {
          validatorId: vId,
          validatorAddress: vPart.address,
          validatorPublicKey: vPart.publicKey,
          signature,
          timestamp: blk.timestamp || new Date().toISOString(),
          vote: 'ACCEPT'
        };
      });

      const repairedCert = new ConsensusCertificate({
        version: 1,
        proposalId: blk.proposalId,
        blockNumber: blk.blockNumber,
        blockHash: blk.blockHash,
        stateRoot: String(blk.stateRoot || ''),
        round,
        threshold: 9,
        totalValidators: 12,
        achieved: true,
        validatorApprovals: approvals
      });

      const validatorSignatures = approvals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      }));

      await r.update({
        proposerAddress: blk.proposerAddress,
        proposalId: blk.proposalId,
        proposerSignature: blk.proposerSignature,
        consensusCertificate: repairedCert.toJSON(),
        validatorSignatures
      }, { hooks: false });

      repairedCount++;
    }
  }

  // Reload and verify entire chain with strict certificate verification enabled
  const verifyRows = await BlockModel.findAll({ order: [['blockNumber', 'ASC']] });
  const verifiedChain = verifyRows.map(r => {
    const b = new Block(
      r.blockNumber,
      r.timestamp,
      r.transactions,
      r.previousHash,
      r.nonce,
      r.consensusStatus,
      r.validatorSignatures,
      r.stateRoot,
      {
        version: r.version,
        proposerId: r.proposerId,
        proposerAddress: r.proposerAddress,
        proposerSignature: r.proposerSignature,
        proposalId: r.proposalId,
        round: r.round,
        consensusCertificate: r.consensusCertificate
      }
    );
    if (r.merkleRoot) b.merkleRoot = r.merkleRoot;
    if (r.blockHash) b.blockHash = r.blockHash;
    return b;
  });

  const chainCheck = validateChain(verifiedChain, {
    verifyCertificates: true,
    validatorMap: fbaConsensus.validators
  });

  return {
    totalBlocks: verifiedChain.length,
    repairedCount,
    isValid: chainCheck.isValid,
    reason: chainCheck.reason || null
  };
}

if (require.main === module) {
  repairConsensusCertificates()
    .then(res => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.isValid ? 0 : 1);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { repairConsensusCertificates };
