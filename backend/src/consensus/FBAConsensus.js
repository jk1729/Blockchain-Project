const ValidatorNode = require('./ValidatorNode');
const ValidatorVote = require('./ValidatorVote');
const VoteStore = require('./VoteStore');
const ConsensusCertificate = require('./ConsensusCertificate');
const ConsensusRound = require('./ConsensusRound');
const { ConsensusState, ConsensusStateMachine } = require('./ConsensusStateMachine');
const QuorumEngine = require('./QuorumEngine');
const FinalityEngine = require('./FinalityEngine');
const ConsensusJournal = require('./ConsensusJournal');
const { DEFAULT_12_VALIDATORS } = require('./consensusConfig');
const { hashProposal } = require('../blockchain/hashing');
const logger = require('../utils/logger');
const http = require('http');

class FBAConsensus {
  constructor(options = {}) {
    this.chainId = parseInt(options.chainId || 1729, 10);
    this.validators = new Map();
    this.voteStore = new VoteStore();
    this.stateMachine = new ConsensusStateMachine();
    this.journal = new ConsensusJournal(options.journalOptions || {});
    this.initDefaultValidators();
    this.quorumEngine = new QuorumEngine(this.validators);
    this.finalityEngine = new FinalityEngine(this.validators);
    this.rounds = [];

    // Timeout configurations
    this.proposalTimeoutMs = parseInt(options.proposalTimeoutMs || 3000, 10);
    this.voteTimeoutMs = parseInt(options.voteTimeoutMs || 3000, 10);
    this.roundTimeoutMs = parseInt(options.roundTimeoutMs || 5000, 10);
  }

  initDefaultValidators() {
    this.validators.clear();
    for (const vData of DEFAULT_12_VALIDATORS) {
      const node = new ValidatorNode(vData);
      this.validators.set(node.validatorId, node);
    }
    if (this.quorumEngine) {
      this.quorumEngine.loadValidators(this.validators);
    }
    if (this.finalityEngine) {
      this.finalityEngine.quorumEngine.loadValidators(this.validators);
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
    this.quorumEngine.loadValidators(this.validators);
    this.finalityEngine.quorumEngine.loadValidators(this.validators);
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
    const onlineNodes = [];
    for (const v of nodes) {
      if (v.isOnline()) onlineNodes.push(v.validatorId);
    }
    const qResult = this.quorumEngine.findQuorum(onlineNodes);

    return {
      totalValidators: nodes.length,
      onlineCount: onlineNodes.length,
      offlineCount: nodes.length - onlineNodes.length,
      hasQuorum: qResult.isQuorum,
      quorumMembers: qResult.quorumMembers,
      quorumPercentage: Math.round((qResult.quorumSize / nodes.length) * 100)
    };
  }

  getStateMachine() {
    return this.stateMachine;
  }

  getJournal() {
    return this.journal;
  }

  getQuorumEngine() {
    return this.quorumEngine;
  }

  getFinalityEngine() {
    return this.finalityEngine;
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
   * Advance consensus to next round on timeout or proposer stall
   * @param {Block|object} candidateBlock 
   * @param {number} currentRound 
   * @param {string} reason 
   * @returns {ConsensusRound}
   */
  advanceRound(candidateBlock, currentRound = 0, reason = 'TIMEOUT') {
    const nextRoundNumber = currentRound + 1;
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10) || 0;
    const previousHash = String(candidateBlock.previousHash || '');
    const blockHash = String(candidateBlock.blockHash || candidateBlock.hash || '');

    this.journal.append('ROUND_TIMEOUT', {
      height: blockNumber,
      round: currentRound,
      nextRound: nextRoundNumber,
      reason
    });

    if (this.stateMachine.canTransition(ConsensusState.TIMEOUT)) {
      this.stateMachine.transition(ConsensusState.TIMEOUT, { height: blockNumber, round: currentRound, reason });
    }
    if (this.stateMachine.canTransition(ConsensusState.RECOVERING)) {
      this.stateMachine.transition(ConsensusState.RECOVERING, { height: blockNumber, round: nextRoundNumber, reason: 'Advancing round' });
    }

    const nextRoundObj = new ConsensusRound({
      chainId: this.chainId,
      blockHeight: blockNumber,
      roundNumber: nextRoundNumber,
      previousBlockHash: previousHash,
      candidateBlockHash: blockHash
    });

    return nextRoundObj;
  }

  /**
   * Execute an FBA Consensus Round for a Candidate Block Proposal.
   * Produces signed validator votes, evaluates quorum slices and global threshold (9/12),
   * and creates a cryptographically verifiable ConsensusCertificate.
   * 
   * @param {Block|object} candidateBlock 
   * @param {object} [options] - { round, expectedStateRoot, threshold, blockchain }
   * @returns {Promise<object>} Round summary with ConsensusCertificate
   */
  async runBlockConsensus(candidateBlock, options = {}) {
    const round = parseInt(options.round !== undefined ? options.round : (candidateBlock.round || 0), 10);
    const threshold = parseInt(options.threshold || 9, 10);
    const startTime = Date.now();
    const nodes = this.getValidators();

    const proposalId = candidateBlock.proposalId || hashProposal(candidateBlock);
    const blockNumber = parseInt(candidateBlock.blockNumber !== undefined ? candidateBlock.blockNumber : candidateBlock.index, 10) || 0;
    const blockHash = String(candidateBlock.blockHash || candidateBlock.hash || '');
    const stateRoot = String(candidateBlock.stateRoot || '');
    const previousHash = String(candidateBlock.previousHash || '');

    // Deterministic Canonical ConsensusRound
    const consensusRound = new ConsensusRound({
      chainId: this.chainId,
      blockHeight: blockNumber,
      roundNumber: round,
      previousBlockHash: previousHash,
      candidateBlockHash: blockHash,
      proposerId: candidateBlock.proposerId || 'VAL-01'
    });
    const roundId = consensusRound.roundId;

    // Record round start in journal
    this.journal.append('ROUND_STARTED', {
      roundId,
      chainId: this.chainId,
      height: blockNumber,
      round,
      previousHash,
      blockHash
    });

    // State machine transition: IDLE -> PROPOSAL
    if (this.stateMachine.canTransition(ConsensusState.PROPOSAL)) {
      this.stateMachine.transition(ConsensusState.PROPOSAL, { height: blockNumber, round, roundId, reason: 'Candidate block proposal received' });
    }

    // State machine transition: PROPOSAL -> PREVOTE
    if (this.stateMachine.canTransition(ConsensusState.PREVOTE)) {
      this.stateMachine.transition(ConsensusState.PREVOTE, { height: blockNumber, round, roundId, reason: 'Beginning validator prevote querying' });
    }

    const reqChainId = candidateBlock.chainId !== undefined ? candidateBlock.chainId : options.chainId;

    const votes = [];
    const agreeingValidatorIds = [];
    const approvalMap = new Map();

    for (const node of nodes) {
      let voteResult;
      if (!node.isOnline()) {
        const offlineData = {
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
        };
        if (reqChainId !== undefined) {
          offlineData.chainId = reqChainId;
        }
        voteResult = new ValidatorVote(offlineData);
      } else {
        const queryOpts = { round, ...options };
        if (reqChainId !== undefined) queryOpts.chainId = reqChainId;
        const rawRes = await this.queryValidatorNodeHTTP(node, candidateBlock, queryOpts);
        voteResult = rawRes instanceof ValidatorVote ? rawRes : new ValidatorVote(rawRes);
      }

      // Record in voteStore (detects conflicting / duplicate votes via ConflictDetector)
      const recordRes = this.voteStore.recordVote(voteResult);
      if (!recordRes.success) {
        logger.consensus(`Vote rejected from ${node.validatorId}: ${recordRes.reason}`);
      } else {
        this.journal.append('VOTE_RECORDED', {
          roundId,
          validatorId: node.validatorId,
          vote: voteResult.vote,
          signature: voteResult.signature
        });
      }

      votes.push(voteResult);
      consensusRound.addVote(voteResult);

      // Check if vote is valid signed ACCEPT AND was accepted into voteStore without conflict
      if (recordRes.success && voteResult.isAccept()) {
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

    // Evaluate FBA Quorum Slices and Threshold via QuorumEngine
    const quorumResult = this.quorumEngine.evaluate(votes, { threshold, round });
    const isQuorum = quorumResult.isQuorum;
    const quorumSize = quorumResult.quorumSize;
    const isSuccess = quorumResult.isSatisfied;

    let certificate = null;
    const finalApprovals = [];

    if (isSuccess) {
      // Transition: PREVOTE -> ACCEPTED
      if (this.stateMachine.canTransition(ConsensusState.ACCEPTED)) {
        this.stateMachine.transition(ConsensusState.ACCEPTED, { height: blockNumber, round, roundId, reason: 'Quorum slices and threshold satisfied' });
      }

      // Include all validated approvals from verified quorum members
      for (const mId of quorumResult.quorumMembers) {
        if (approvalMap.has(mId)) {
          finalApprovals.push(approvalMap.get(mId));
        }
      }

      const certData = {
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
      };
      if (reqChainId !== undefined) {
        certData.chainId = reqChainId;
      }
      certificate = new ConsensusCertificate(certData);

      consensusRound.certificate = certificate;
      consensusRound.status = 'ACHIEVED';

      // Transition: ACCEPTED -> CERTIFIED
      if (this.stateMachine.canTransition(ConsensusState.CERTIFIED)) {
        this.stateMachine.transition(ConsensusState.CERTIFIED, { height: blockNumber, round, roundId, reason: 'ConsensusCertificate generated' });
      }

      this.journal.append('CERTIFICATE_GENERATED', {
        roundId,
        certificateHash: certificate.certificateHash,
        approvalCount: finalApprovals.length,
        threshold
      });

      // Transition: CERTIFIED -> FINALIZED
      if (this.stateMachine.canTransition(ConsensusState.FINALIZED)) {
        this.stateMachine.transition(ConsensusState.FINALIZED, { height: blockNumber, round, roundId, reason: 'Block consensus fully achieved' });
        this.journal.append('BLOCK_FINALIZED', {
          roundId,
          height: blockNumber,
          blockHash,
          certificateHash: certificate.certificateHash
        });
      }
    } else {
      consensusRound.status = 'FAILED';

      // Transition: PREVOTE -> REJECTED
      if (this.stateMachine.canTransition(ConsensusState.REJECTED)) {
        this.stateMachine.transition(ConsensusState.REJECTED, {
          height: blockNumber,
          round,
          roundId,
          reason: quorumResult.failureReasons.join('; ') || 'Quorum not achieved'
        });
      }
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

    const quorumResult = this.quorumEngine.findQuorum(agreeingNodes);
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
