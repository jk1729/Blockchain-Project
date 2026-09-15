class VoteStore {
  constructor() {
    // Map: proposalId -> Array<ValidatorVote>
    this.votesByProposal = new Map();
    // Map: `${validatorId}:${round}` -> ValidatorVote
    this.votesByValidatorRound = new Map();
    // All votes array
    this.allVotes = [];
  }

  /**
   * Record a validator vote and detect duplicate or conflicting votes
   * @param {ValidatorVote|object} vote 
   * @returns {{ success: boolean, code?: string, reason?: string, vote: ValidatorVote }}
   */
  recordVote(vote) {
    if (!vote || !vote.validatorId) {
      return { success: false, code: 'INVALID_VOTE', reason: 'Validator vote is missing validatorId' };
    }

    const key = `${vote.validatorId}:${vote.round}`;
    const existingVote = this.votesByValidatorRound.get(key);

    if (existingVote) {
      // Check if it is a duplicate identical vote
      if (existingVote.proposalId === vote.proposalId && existingVote.blockHash === vote.blockHash && existingVote.vote === vote.vote) {
        return {
          success: false,
          code: 'DUPLICATE_VOTE',
          reason: `Validator ${vote.validatorId} already submitted an identical vote for proposal ${vote.proposalId} in round ${vote.round}`
        };
      }

      // Check if it is a conflicting double vote
      if (existingVote.isAccept && existingVote.isAccept() && vote.isAccept && vote.isAccept()) {
        if (existingVote.proposalId !== vote.proposalId || existingVote.blockHash !== vote.blockHash) {
          return {
            success: false,
            code: 'CONFLICTING_VOTE',
            reason: `CONFLICTING_VOTE: Validator ${vote.validatorId} already voted ACCEPT for proposal ${existingVote.proposalId} in round ${vote.round}. Cannot vote for competing proposal ${vote.proposalId}.`
          };
        }
      }
    }

    // Store the vote
    this.votesByValidatorRound.set(key, vote);

    if (!this.votesByProposal.has(vote.proposalId)) {
      this.votesByProposal.set(vote.proposalId, []);
    }
    this.votesByProposal.get(vote.proposalId).push(vote);
    this.allVotes.push(vote);

    return { success: true, vote };
  }

  getVotesForProposal(proposalId) {
    return this.votesByProposal.get(proposalId) || [];
  }

  getVoteForValidatorRound(validatorId, round) {
    return this.votesByValidatorRound.get(`${validatorId}:${round}`) || null;
  }

  clear() {
    this.votesByProposal.clear();
    this.votesByValidatorRound.clear();
    this.allVotes = [];
  }
}

module.exports = VoteStore;

