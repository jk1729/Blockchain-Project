const { ConflictDetector, ConflictCode } = require('./ConflictDetector');

class VoteStore {
  constructor() {
    // Map: proposalId -> Array<ValidatorVote>
    this.votesByProposal = new Map();
    // Map: `${validatorId}:${round}` -> ValidatorVote (legacy compatibility)
    this.votesByValidatorRound = new Map();
    // Map: `${validatorId}:${blockNumber}:${round}` -> ValidatorVote
    this.votesByValidatorHeightRound = new Map();
    // Map: blockNumber -> Array<ValidatorVote>
    this.votesByHeight = new Map();
    // Map: blockHash -> Array<ValidatorVote>
    this.votesByBlockHash = new Map();
    // All votes array
    this.allVotes = [];
    // Conflict detector instance
    this.conflictDetector = new ConflictDetector();
  }

  /**
   * Record a validator vote, verify against conflicts and duplicate submissions
   * @param {ValidatorVote|object} vote 
   * @returns {{ success: boolean, code?: string, reason?: string, vote: ValidatorVote }}
   */
  recordVote(vote) {
    if (!vote || !vote.validatorId) {
      return { success: false, code: 'INVALID_VOTE', reason: 'Validator vote is missing validatorId' };
    }

    const vId = vote.validatorId;
    const round = parseInt(vote.round, 10) || 0;
    const blockNumber = parseInt(vote.blockNumber !== undefined ? vote.blockNumber : vote.blockIndex, 10) || 0;
    const proposalId = String(vote.proposalId || '');
    const blockHash = String(vote.blockHash || '');

    // Get prior votes for this validator
    const priorVotes = this.allVotes.filter(v => v.validatorId === vId);
    const check = this.conflictDetector.checkVote(vote, priorVotes);

    if (check.code === ConflictCode.DUPLICATE_IDENTICAL) {
      return {
        success: false,
        code: 'DUPLICATE_VOTE',
        reason: check.reason || `Validator ${vId} already submitted an identical vote for proposal ${proposalId} in round ${round}`
      };
    }

    if (check.code === ConflictCode.CONFLICTING_DOUBLE_VOTE) {
      return {
        success: false,
        code: 'CONFLICTING_VOTE',
        reason: check.reason || `CONFLICTING_VOTE: Validator ${vId} already voted ACCEPT for another block in round ${round}`
      };
    }

    if (check.code === ConflictCode.EQUIVOCATION) {
      return {
        success: false,
        code: 'EQUIVOCATING_VOTE',
        reason: check.reason || `EQUIVOCATING_VOTE: Validator ${vId} contradictory votes in round ${round}`
      };
    }

    // Secondary legacy check for existing vote in round
    const legacyKey = `${vId}:${round}`;
    const existingLegacy = this.votesByValidatorRound.get(legacyKey);
    if (existingLegacy) {
      if (existingLegacy.proposalId === proposalId && existingLegacy.blockHash === blockHash && existingLegacy.vote === vote.vote) {
        return {
          success: false,
          code: 'DUPLICATE_VOTE',
          reason: `Validator ${vId} already submitted an identical vote for proposal ${proposalId} in round ${round}`
        };
      }
      if (existingLegacy.isAccept && existingLegacy.isAccept() && vote.isAccept && vote.isAccept()) {
        if (existingLegacy.proposalId !== proposalId || existingLegacy.blockHash !== blockHash) {
          return {
            success: false,
            code: 'CONFLICTING_VOTE',
            reason: `CONFLICTING_VOTE: Validator ${vId} already voted ACCEPT for proposal ${existingLegacy.proposalId} in round ${round}. Cannot vote for competing proposal ${proposalId}.`
          };
        }
      }
    }

    // Store in all multi-index lookups
    this.votesByValidatorRound.set(legacyKey, vote);

    const fullKey = `${vId}:${blockNumber}:${round}`;
    this.votesByValidatorHeightRound.set(fullKey, vote);

    if (!this.votesByProposal.has(proposalId)) {
      this.votesByProposal.set(proposalId, []);
    }
    this.votesByProposal.get(proposalId).push(vote);

    if (!this.votesByHeight.has(blockNumber)) {
      this.votesByHeight.set(blockNumber, []);
    }
    this.votesByHeight.get(blockNumber).push(vote);

    if (blockHash) {
      if (!this.votesByBlockHash.has(blockHash)) {
        this.votesByBlockHash.set(blockHash, []);
      }
      this.votesByBlockHash.get(blockHash).push(vote);
    }

    this.allVotes.push(vote);

    return { success: true, vote };
  }

  getVotesForProposal(proposalId) {
    return this.votesByProposal.get(String(proposalId)) || [];
  }

  getVoteForValidatorRound(validatorId, round) {
    return this.votesByValidatorRound.get(`${validatorId}:${round}`) || null;
  }

  getVoteForValidatorHeightRound(validatorId, height, round) {
    return this.votesByValidatorHeightRound.get(`${validatorId}:${height}:${round}`) || null;
  }

  getVotesByHeight(height) {
    return this.votesByHeight.get(parseInt(height, 10)) || [];
  }

  getVotesByBlockHash(blockHash) {
    return this.votesByBlockHash.get(String(blockHash)) || [];
  }

  getConflicts() {
    return this.conflictDetector.getConflicts();
  }

  hasVoted(validatorId, round, height = null) {
    if (height !== null) {
      return this.votesByValidatorHeightRound.has(`${validatorId}:${height}:${round}`);
    }
    return this.votesByValidatorRound.has(`${validatorId}:${round}`);
  }

  clear() {
    this.votesByProposal.clear();
    this.votesByValidatorRound.clear();
    this.votesByValidatorHeightRound.clear();
    this.votesByHeight.clear();
    this.votesByBlockHash.clear();
    this.allVotes = [];
    this.conflictDetector.clear();
  }
}

module.exports = VoteStore;
