/**
 * ConflictDetector Class
 * Detects duplicate identical votes, conflicting double-votes, and equivocations
 * in FBA consensus rounds.
 */

const ConflictCode = {
  VALID: 'VALID',
  DUPLICATE_IDENTICAL: 'DUPLICATE_IDENTICAL',
  CONFLICTING_DOUBLE_VOTE: 'CONFLICTING_DOUBLE_VOTE',
  EQUIVOCATION: 'EQUIVOCATION'
};

class ConflictDetector {
  constructor() {
    // Array of recorded conflict events for auditing/slashing records
    this.conflictRecords = [];
  }

  /**
   * Check a candidate vote against previously recorded votes for the same validator
   * @param {object} vote - The new vote
   * @param {Array<object>} existingVotes - Previously recorded votes for this validator
   * @returns {{ hasConflict: boolean, code: string, reason?: string, conflictingVote?: object }}
   */
  checkVote(vote, existingVotes = []) {
    if (!vote || !vote.validatorId) {
      return { hasConflict: false, code: ConflictCode.VALID };
    }

    const vId = vote.validatorId;
    const blockNumber = parseInt(vote.blockNumber !== undefined ? vote.blockNumber : vote.blockIndex, 10) || 0;
    const round = parseInt(vote.round, 10) || 0;
    const proposalId = String(vote.proposalId || '');
    const blockHash = String(vote.blockHash || '');
    const voteType = String(vote.vote || '').toUpperCase();
    const chainId = vote.chainId !== undefined ? parseInt(vote.chainId, 10) : null;

    for (const prior of existingVotes) {
      if (!prior) continue;
      const priorRound = parseInt(prior.round, 10) || 0;
      const priorBlockNumber = parseInt(prior.blockNumber !== undefined ? prior.blockNumber : prior.blockIndex, 10) || 0;
      const priorProposalId = String(prior.proposalId || '');
      const priorBlockHash = String(prior.blockHash || '');
      const priorVoteType = String(prior.vote || '').toUpperCase();
      const priorChainId = prior.chainId !== undefined ? parseInt(prior.chainId, 10) : null;

      // Check cross-chain mismatch if chainIds are present
      if (chainId !== null && priorChainId !== null && chainId !== priorChainId) {
        continue; // Different chains, evaluated separately
      }

      // Votes in different rounds or different heights do not conflict as double-votes
      if (priorRound !== round || priorBlockNumber !== blockNumber) {
        continue;
      }

      // 1. Identical duplicate vote
      if (priorProposalId === proposalId && priorBlockHash === blockHash && priorVoteType === voteType) {
        return {
          hasConflict: false,
          code: ConflictCode.DUPLICATE_IDENTICAL,
          reason: `DUPLICATE_VOTE: Validator ${vId} already submitted an identical vote for proposal ${proposalId} in round ${round}`,
          conflictingVote: prior
        };
      }

      // 2. Conflicting double-vote (both ACCEPT for competing blocks/proposals in the same round)
      if (priorVoteType === 'ACCEPT' && voteType === 'ACCEPT') {
        if (priorBlockHash !== blockHash || priorProposalId !== proposalId) {
          const conflictEvent = {
            validatorId: vId,
            blockNumber,
            round,
            code: ConflictCode.CONFLICTING_DOUBLE_VOTE,
            vote1: { proposalId: priorProposalId, blockHash: priorBlockHash, signature: prior.signature },
            vote2: { proposalId, blockHash, signature: vote.signature },
            timestamp: new Date().toISOString(),
            reason: `CONFLICTING_DOUBLE_VOTE: Validator ${vId} voted ACCEPT for competing block/proposal in height #${blockNumber}, round ${round}`
          };
          this.conflictRecords.push(conflictEvent);

          return {
            hasConflict: true,
            code: ConflictCode.CONFLICTING_DOUBLE_VOTE,
            reason: conflictEvent.reason,
            conflictingVote: prior,
            conflictEvent
          };
        }
      }

      // 3. Equivocation (ACCEPT and REJECT for the same proposal in the same round)
      if (priorProposalId === proposalId && priorVoteType !== voteType) {
        const equivocationEvent = {
          validatorId: vId,
          blockNumber,
          round,
          code: ConflictCode.EQUIVOCATION,
          vote1: { proposalId: priorProposalId, vote: priorVoteType, signature: prior.signature },
          vote2: { proposalId, vote: voteType, signature: vote.signature },
          timestamp: new Date().toISOString(),
          reason: `EQUIVOCATION: Validator ${vId} submitted contradictory votes (${priorVoteType} vs ${voteType}) for proposal ${proposalId} in round ${round}`
        };
        this.conflictRecords.push(equivocationEvent);

        return {
          hasConflict: true,
          code: ConflictCode.EQUIVOCATION,
          reason: equivocationEvent.reason,
          conflictingVote: prior,
          conflictEvent: equivocationEvent
        };
      }
    }

    return { hasConflict: false, code: ConflictCode.VALID };
  }

  /**
   * Scan a batch of votes for any internal conflicts
   * @param {Array<object>} votes 
   * @returns {{ hasConflict: boolean, conflicts: Array<object> }}
   */
  checkBatch(votes = []) {
    const votesByValidator = new Map();
    const conflicts = [];

    for (const vote of votes) {
      if (!vote || !vote.validatorId) continue;
      const vId = vote.validatorId;
      const existing = votesByValidator.get(vId) || [];
      const check = this.checkVote(vote, existing);

      if (check.hasConflict) {
        conflicts.push(check);
      } else if (check.code === ConflictCode.VALID) {
        existing.push(vote);
        votesByValidator.set(vId, existing);
      }
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts
    };
  }

  getConflicts() {
    return [...this.conflictRecords];
  }

  clear() {
    this.conflictRecords = [];
  }
}

module.exports = {
  ConflictCode,
  ConflictDetector
};

