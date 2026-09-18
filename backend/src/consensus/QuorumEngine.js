const { DEFAULT_12_VALIDATORS } = require('./consensusConfig');
const ValidatorNode = require('./ValidatorNode');
const QuorumResult = require('./QuorumResult');
const { QuorumErrorCode } = require('./QuorumErrors');

class QuorumEngine {
  /**
   * @param {Map<string, ValidatorNode>|Array<ValidatorNode>|Array<object>} [validators]
   * @param {object} [options]
   */
  constructor(validators = null, options = {}) {
    this.defaultThreshold = parseInt(options.threshold, 10) || 9;
    this.validatorMap = new Map();

    if (validators) {
      this.loadValidators(validators);
    } else {
      this.loadDefaultValidators();
    }
  }

  loadDefaultValidators() {
    this.validatorMap.clear();
    for (const vData of DEFAULT_12_VALIDATORS) {
      const node = new ValidatorNode(vData);
      this.validatorMap.set(node.validatorId, node);
    }
  }

  loadValidators(validators) {
    this.validatorMap.clear();
    if (validators instanceof Map) {
      for (const [id, node] of validators.entries()) {
        this.validatorMap.set(id, node instanceof ValidatorNode ? node : new ValidatorNode(node));
      }
    } else if (Array.isArray(validators)) {
      for (const v of validators) {
        const node = v instanceof ValidatorNode ? v : new ValidatorNode(v);
        this.validatorMap.set(node.validatorId, node);
      }
    }
  }

  getValidator(id) {
    return this.validatorMap.get(id) || null;
  }

  getAllValidators() {
    return Array.from(this.validatorMap.values());
  }

  getTotalValidatorCount() {
    return this.validatorMap.size;
  }

  /**
   * Check whether a specific validator's quorum slice is satisfied by a set of agreeing nodes
   * @param {string} validatorId 
   * @param {string[]|Set<string>} agreeingNodes 
   * @returns {boolean}
   */
  isSliceSatisfied(validatorId, agreeingNodes) {
    const node = this.validatorMap.get(validatorId);
    if (!node) return false;
    const agreeArr = agreeingNodes instanceof Set ? Array.from(agreeingNodes) : (agreeingNodes || []);
    return Boolean(node.quorumSlice && node.quorumSlice.isSatisfied(agreeArr));
  }

  /**
   * Check if candidate set U forms a self-contained quorum (every node in U has its slice satisfied in U)
   * @param {string[]|Set<string>} candidateSet 
   * @returns {boolean}
   */
  isQuorumSatisfied(candidateSet) {
    const set = candidateSet instanceof Set ? candidateSet : new Set(candidateSet || []);
    if (set.size === 0) return false;

    for (const nodeId of set) {
      const node = this.validatorMap.get(nodeId);
      if (!node) return false;
      if (!node.isOnline()) return false;
      if (!node.quorumSlice.isSatisfied(Array.from(set))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if count meets global network threshold
   * @param {number} count 
   * @param {number} [threshold=9] 
   * @returns {boolean}
   */
  hasGlobalThreshold(count, threshold = this.defaultThreshold) {
    return count >= threshold;
  }

  /**
   * Extract list of supporting validator IDs from votes or raw IDs
   * @param {Array<object|string>} votesOrIds 
   * @returns {string[]} Sorted unique validator IDs
   */
  getSupportingValidators(votesOrIds) {
    if (!Array.isArray(votesOrIds)) return [];
    const ids = new Set();
    for (const item of votesOrIds) {
      if (typeof item === 'string') {
        ids.add(item);
      } else if (item && typeof item === 'object') {
        const id = item.validatorId;
        const vote = String(item.vote || 'ACCEPT').toUpperCase();
        if (id && (vote === 'ACCEPT' || vote === 'AGREE')) {
          ids.add(id);
        }
      }
    }
    return Array.from(ids).sort();
  }

  /**
   * Return validators that are missing from agreeing set or offline
   * @param {string[]|Set<string>} agreeingNodes 
   * @returns {string[]}
   */
  getMissingValidators(agreeingNodes) {
    const agreeSet = agreeingNodes instanceof Set ? agreeingNodes : new Set(agreeingNodes || []);
    const missing = [];
    for (const [id, node] of this.validatorMap.entries()) {
      if (!agreeSet.has(id) || !node.isOnline()) {
        missing.push(id);
      }
    }
    return missing.sort();
  }

  /**
   * Detect conflicting votes (e.g. double-voting for different blocks or proposals in same round)
   * @param {Array<object>} votes 
   * @returns {{ hasConflict: boolean, conflicts: Array<object> }}
   */
  detectConflict(votes) {
    if (!Array.isArray(votes)) return { hasConflict: false, conflicts: [] };

    const votesByValidator = new Map();
    const conflicts = [];

    for (const vote of votes) {
      if (!vote || !vote.validatorId) continue;
      const vId = vote.validatorId;
      const isAccept = (vote.isAccept && typeof vote.isAccept === 'function')
        ? vote.isAccept()
        : String(vote.vote || '').toUpperCase() === 'ACCEPT';

      if (!isAccept) continue;

      const round = vote.round !== undefined ? vote.round : 0;
      const key = `${vId}:${round}`;
      const blockHash = String(vote.blockHash || '');
      const proposalId = String(vote.proposalId || '');

      if (votesByValidator.has(key)) {
        const existing = votesByValidator.get(key);
        const existingBlockHash = String(existing.blockHash || '');
        const existingProposalId = String(existing.proposalId || '');

        if ((blockHash && existingBlockHash && blockHash !== existingBlockHash) ||
            (proposalId && existingProposalId && proposalId !== existingProposalId)) {
          conflicts.push({
            validatorId: vId,
            round,
            vote1: { proposalId: existingProposalId, blockHash: existingBlockHash },
            vote2: { proposalId, blockHash },
            reason: `Validator ${vId} double-voted in round ${round} for competing blocks/proposals`
          });
        }
      } else {
        votesByValidator.set(key, vote);
      }
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts
    };
  }

  /**
   * Backward-compatible FBA maximal quorum reduction
   * @param {string[]|Set<string>} agreeingNodes 
   * @returns {{ isQuorum: boolean, quorumMembers: string[], quorumSize: number }}
   */
  findQuorum(agreeingNodes) {
    let U = new Set(agreeingNodes || []);

    let changed = true;
    while (changed) {
      changed = false;
      for (const nodeId of Array.from(U)) {
        const node = this.validatorMap.get(nodeId);
        if (!node || !node.isOnline() || !node.quorumSlice.isSatisfied(Array.from(U))) {
          U.delete(nodeId);
          changed = true;
        }
      }
    }

    const quorumMembers = Array.from(U).sort();
    return {
      isQuorum: quorumMembers.length > 0,
      quorumMembers,
      quorumSize: quorumMembers.length
    };
  }

  /**
   * Evaluate full FBA consensus state for a candidate round or vote set
   * @param {Array<string|object>} agreeingVotesOrIds 
   * @param {object} [options] - { threshold, round, requireOnline }
   * @returns {QuorumResult}
   */
  evaluate(agreeingVotesOrIds, options = {}) {
    const threshold = parseInt(options.threshold, 10) || this.defaultThreshold;
    const totalValidators = this.validatorMap.size;
    const failureReasons = [];

    // Extract supporting validator IDs and raw votes if provided
    let rawVotes = [];
    let supportingIds = [];
    if (Array.isArray(agreeingVotesOrIds) && agreeingVotesOrIds.length > 0 && typeof agreeingVotesOrIds[0] === 'object') {
      rawVotes = agreeingVotesOrIds;
      supportingIds = this.getSupportingValidators(agreeingVotesOrIds);
    } else {
      supportingIds = this.getSupportingValidators(agreeingVotesOrIds);
    }

    // Check for conflicting double votes
    const conflictCheck = this.detectConflict(rawVotes);
    if (conflictCheck.hasConflict) {
      for (const c of conflictCheck.conflicts) {
        failureReasons.push(`${QuorumErrorCode.DOUBLE_VOTE_DETECTED}: ${c.reason}`);
      }
    }

    // Filter agreeing nodes to those registered and online
    const validAgreeingIds = [];
    for (const id of supportingIds) {
      const node = this.validatorMap.get(id);
      if (!node) {
        failureReasons.push(`${QuorumErrorCode.UNKNOWN_VALIDATOR}: Validator '${id}' is not in validator registry`);
        continue;
      }
      if (!node.isOnline()) {
        failureReasons.push(`${QuorumErrorCode.OFFLINE_VALIDATOR}: Validator '${id}' is offline`);
        continue;
      }
      validAgreeingIds.push(id);
    }

    // Execute maximal quorum reduction algorithm
    const reduction = this.findQuorum(validAgreeingIds);
    const isQuorum = reduction.isQuorum;
    const quorumMembers = reduction.quorumMembers;
    const quorumSize = reduction.quorumSize;

    // Check global agreement threshold
    const hasGlobalThreshold = this.hasGlobalThreshold(quorumSize, threshold);
    if (!hasGlobalThreshold) {
      failureReasons.push(
        `${QuorumErrorCode.INSUFFICIENT_NODES}: Quorum size ${quorumSize} does not meet required global threshold ${threshold}`
      );
    }

    // Individual slice evaluations across all registered validators
    const sliceEvaluations = {};
    const agreeSet = new Set(validAgreeingIds);
    for (const [id, node] of this.validatorMap.entries()) {
      const sliceMembers = node.quorumSlice ? node.quorumSlice.members : [];
      const sliceThreshold = node.quorumSlice ? node.quorumSlice.threshold : 0;
      const agreedMembers = sliceMembers.filter(m => agreeSet.has(m)).sort();
      const missingMembers = sliceMembers.filter(m => !agreeSet.has(m)).sort();
      const satisfied = Boolean(node.quorumSlice && node.quorumSlice.isSatisfied(validAgreeingIds));

      sliceEvaluations[id] = {
        satisfied,
        threshold: sliceThreshold,
        members: sliceMembers,
        agreedMembers,
        missingMembers
      };
    }

    // Identify overall missing validators
    const missingValidators = this.getMissingValidators(validAgreeingIds);

    const isSatisfied = isQuorum && hasGlobalThreshold && !conflictCheck.hasConflict;

    return new QuorumResult({
      isQuorum,
      hasGlobalThreshold,
      isSatisfied,
      quorumMembers,
      quorumSize,
      threshold,
      totalValidators,
      supportingValidators: validAgreeingIds,
      missingValidators,
      sliceEvaluations,
      conflictDetected: conflictCheck.hasConflict,
      conflicts: conflictCheck.conflicts,
      failureReasons
    });
  }
}

module.exports = QuorumEngine;

