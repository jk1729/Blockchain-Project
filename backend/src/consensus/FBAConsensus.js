const ValidatorNode = require('./ValidatorNode');
const ValidatorVote = require('./ValidatorVote');
const VoteStore = require('./VoteStore');
const ConsensusCertificate = require('./ConsensusCertificate');
const { DEFAULT_12_VALIDATORS } = require('./consensusConfig');
const { findQuorum, evaluateNetworkQuorum } = require('./Quorum');
const { hashProposal } = require('../blockchain/hashing');
const logger = require('../utils/logger');
const http = require('http');

class FBAConsensus {
  constructor() {
    this.validators = new Map();
    this.voteStore = new VoteStore();
    this.initDefaultValidators();
    this.rounds = [];
  }

  initDefaultValidators() {
    this.validators.clear();
    for (const vData of DEFAULT_12_VALIDATORS) {
      const node = new ValidatorNode(vData);
      this.validators.set(node.validatorId, node);
    }
  }

  loadValidatorsFromDB(validatorRecords) {
    if (!validatorRecords || validatorRecords.length === 0) return;
    this.validators.clear();
    for (const r of validatorRecords) {
      const node = new ValidatorNode({
        validatorId: r.validatorId,
        name: r.name,
        org: r.org,
        publicKey: r.publicKey,
        address: r.address,
        status: r.status,
        blockHeight: r.blockHeight,
        txValidated: r.txValidated,
        participation: r.participation,
        trustConfiguration: r.trustConfiguration
      });
      this.validators.set(node.validatorId, node);
    }
    logger.consensus(`Loaded ${this.validators.size} validators into FBA consensus engine.`);
  }

  getValidators() {
    return Array.from(this.validators.values());
  }

  getValidator(id) {
    return this.validators.get(id) || null;
  }

  setValidatorStatus(id, status) {
    const node = this.validators.get(id);
    if (!node) return false;
    const ok = node.setStatus(status);
    if (ok) {
      logger.consensus(`Validator ${id} status updated to: ${status}`);
    }
    return ok;
  }

  getNetworkStatus() {
    const nodes = this.getValidators();
    return evaluateNetworkQuorum(nodes);
  }

  /**
   * Helper to query validator over HTTP with fallback to local in-process evaluation
   */
  async queryValidatorNodeHTTP(node, proposal, options = {}) {
    const port = 4000 + parseInt(node.validatorId.replace('VAL-', ''), 10);
    const postData = JSON.stringify(proposal);

    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/proposal',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 200
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch (e) {
            resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
              ? node.evaluateBlockProposal(proposal, options)
              : node.evaluateProposal(proposal));
          }
        });
      });

      req.on('error', () => {
        // Fallback to in-process evaluation
        resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
          ? node.evaluateBlockProposal(proposal, options)
          : node.evaluateProposal(proposal));
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(proposal.blockNumber !== undefined || proposal.merkleRoot !== undefined
          ? node.evaluateBlockProposal(proposal, options)
          : node.evaluateProposal(proposal));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Execute an FBA Consensus Round for a Candidate Block Proposal.
   * Produces signed validator votes, evaluates quorum slices and global threshold (9/12),
   * and creates a cryptographically verifiable ConsensusCertificate.
   * 
   * @param {Block|object} candidateBlock 
   * @param {object} [options] - { round, expectedStateRoot, threshold }
   * @returns {Promise<object>} Round summary with ConsensusCertificate
   */
  async runBlockConsensus(candidateBlock, options = {}) {
    const round = parseInt(options.round || candidateBlock.round || 0, 10);
    const roundId = `RND-${Date.now().toString().slice(-6)}`;
    const startTime = Date.now();
    const threshold = parseInt(options.threshold || 9, 10);
    const nodes = this.getValidators();

    const proposalId = candidateBlock.proposalId || hashProposal(candidateBlock);
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10) || 0;
    const blockHash = String(candidateBlock.blockHash || candidateBlock.hash || '');
    const stateRoot = String(candidateBlock.stateRoot || '');

    const votes = [];
    const agreeingValidatorIds = [];
    const approvalMap = new Map();

    for (const node of nodes) {
      let voteResult;
      if (!node.isOnline()) {
        voteResult = new ValidatorVote({
          validatorId: node.validatorId,
          validatorAddress: node.address,
          validatorPublicKey: node.publicKey,
          proposalId,
          blockNumber,
          blockHash,
          stateRoot,
          round,
          vote: 'REJECT',
          reason: 'Node is offline',
          timestamp: new Date().toISOString()
        });
      } else {
        const rawRes = await this.queryValidatorNodeHTTP(node, candidateBlock, { round, ...options });
        voteResult = rawRes instanceof ValidatorVote ? rawRes : new ValidatorVote(rawRes);
      }

      // Record in voteStore (checks for conflicting / duplicate votes)
      const recordRes = this.voteStore.recordVote(voteResult);
      if (!recordRes.success) {
        logger.consensus(`Vote rejected from ${node.validatorId}: ${recordRes.reason}`);
      }

      votes.push(voteResult);

      // Check if vote is valid signed ACCEPT
      if (voteResult.isAccept()) {
        const sigCheck = voteResult.verifySignature();
        if (sigCheck.valid) {
          agreeingValidatorIds.push(node.validatorId);
          approvalMap.set(node.validatorId, {
            validatorId: node.validatorId,
            validatorAddress: node.address || voteResult.validatorAddress,
            validatorPublicKey: node.publicKey || voteResult.validatorPublicKey,
            signature: voteResult.signature,
            timestamp: voteResult.timestamp,
            vote: 'ACCEPT'
          });
        } else {
          logger.consensus(`Validator ${node.validatorId} vote signature verification failed: ${sigCheck.reason}`);
        }
      }
    }

    // Evaluate FBA Quorum Slices across agreeing nodes
    const quorumResult = findQuorum(agreeingValidatorIds, this.validators);
    const isQuorum = quorumResult.isQuorum;
    const quorumSize = quorumResult.quorumSize;
    // Both quorum slices satisfied and quorum set size >= global threshold
    const isSuccess = isQuorum && quorumSize >= threshold;

    let certificate = null;
    const finalApprovals = [];
    if (isSuccess) {
      // Include all validated approvals from quorum members
      for (const mId of quorumResult.quorumMembers) {
        if (approvalMap.has(mId)) {
          finalApprovals.push(approvalMap.get(mId));
        }
      }

      certificate = new ConsensusCertificate({
        version: 1,
        proposalId,
        blockNumber,
        blockHash,
        stateRoot,
        round,
        threshold,
        totalValidators: nodes.length,
        achieved: true,
        validatorApprovals: finalApprovals
      });
    }

    const latencyMs = Math.max(Date.now() - startTime, 12);
    const roundSummary = {
      roundId,
      round,
      proposalId,
      blockNumber,
      blockHash,
      stateRoot,
      timestamp: new Date().toISOString(),
      latencyMs,
      totalValidators: nodes.length,
      participatingValidators: finalApprovals.length,
      agreeingValidators: quorumResult.quorumMembers || agreeingValidatorIds,
      quorumAchieved: isQuorum,
      quorumMembers: quorumResult.quorumMembers,
      quorumSize,
      threshold,
      status: isSuccess ? 'ACHIEVED' : 'FAILED',
      certificate: certificate ? certificate.toJSON() : null,
      validatorSignatures: finalApprovals.map(a => ({
        validatorId: a.validatorId,
        signature: a.signature,
        timestamp: a.timestamp
      })),
      votes: votes.map(v => v.toJSON())
    };

    this.rounds.unshift(roundSummary);
    if (this.rounds.length > 50) this.rounds.pop();

    logger.consensus(`Block #${blockNumber} Consensus Round ${roundId} -> Status: ${roundSummary.status} (Quorum: ${quorumSize}/${nodes.length}, Threshold: ${threshold})`);
    return roundSummary;
  }

  /**
   * Execute a full FBA Consensus Round (backward-compatible legacy and block dispatcher)
   */
  async runConsensusRound(proposal, options = {}) {
    // If proposal looks like candidate block with blockNumber / transactions array
    if (proposal && (proposal.blockNumber !== undefined || proposal.transactions !== undefined)) {
      return await this.runBlockConsensus(proposal, options);
    }

    // Legacy transaction proposal path
    const roundId = `RND-${Date.now().toString().slice(-6)}`;
    const startTime = Date.now();
    const nodes = this.getValidators();
    const votes = [];
    const agreeingNodes = [];
    const validatorSignatures = [];

    for (const node of nodes) {
      let voteResult;
      if (!node.isOnline()) {
        voteResult = {
          validatorId: node.validatorId,
          vote: 'OFFLINE',
          reason: 'Node is offline',
          signature: null
        };
      } else {
        voteResult = await this.queryValidatorNodeHTTP(node, proposal);
      }

      votes.push(voteResult);

      if (voteResult.vote === 'AGREE' || voteResult.vote === 'ACCEPT') {
        agreeingNodes.push(node.validatorId);
        validatorSignatures.push({
          validatorId: node.validatorId,
          signature: voteResult.signature,
          timestamp: voteResult.timestamp
        });
      }
    }

    const quorumResult = findQuorum(agreeingNodes, this.validators);
    const latencyMs = Math.max(Date.now() - startTime, 12);
    const isSuccess = quorumResult.isQuorum && quorumResult.quorumSize >= 9;

    const roundSummary = {
      roundId,
      transactionId: proposal ? proposal.transactionId : null,
      timestamp: new Date().toISOString(),
      latencyMs,
      totalValidators: nodes.length,
      participatingValidators: agreeingNodes.length,
      agreeingValidators: agreeingNodes,
      quorumAchieved: quorumResult.isQuorum,
      quorumMembers: quorumResult.quorumMembers,
      quorumSize: quorumResult.quorumSize,
      status: isSuccess ? 'ACHIEVED' : 'FAILED',
      validatorSignatures,
      votes
    };

    this.rounds.unshift(roundSummary);
    if (this.rounds.length > 50) this.rounds.pop();

    logger.consensus(`Round ${roundId} for ${proposal ? proposal.transactionId : 'N/A'} -> Status: ${roundSummary.status} (Quorum: ${roundSummary.quorumSize}/${nodes.length})`);
    return roundSummary;
  }

  verifyCertificate(certificate, block) {
    return ConsensusCertificate.verify(certificate, block, this.validators);
  }
}

// Singleton consensus coordinator
const fbaInstance = new FBAConsensus();

module.exports = fbaInstance;
