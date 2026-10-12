const consensusService = require('../services/consensusService');

class ConsensusController {
  getStatus(req, res) {
    const status = consensusService.getStatus();
    res.status(200).json({
      success: true,
      consensus: status
    });
  }

  getQuorum(req, res) {
    const quorum = consensusService.getQuorumDetails();
    res.status(200).json({
      success: true,
      ...quorum
    });
  }

  async propose(req, res, next) {
    try {
      const proposal = req.body;
      const result = await consensusService.runConsensus(proposal);
      res.status(200).json({
        success: true,
        result
      });
    } catch (err) {
      next(err);
    }
  }

  async createProposal(req, res, next) {
    try {
      const payload = req.body || {};
      const creator = req.user
        ? (req.user.validatorId || req.user.username || req.user.role)
        : 'SYSTEM';
      if (req.user && req.user.validatorId && !payload.proposerId) {
        payload.proposerId = req.user.validatorId;
      }
      const proposal = await consensusService.createPendingProposal(payload, { createdBy: creator });
      res.status(201).json({
        success: true,
        message: `Created pending candidate block #${proposal.blockNumber} proposal (${proposal.proposalId.slice(0, 12)}...)`,
        proposal
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          code: err.code || 'PROPOSAL_ERROR',
          message: err.message
        });
      }
      next(err);
    }
  }

  getProposals(req, res) {
    const proposals = consensusService.getAllProposals();
    const activeProposal = consensusService.getActiveProposal();
    res.status(200).json({
      success: true,
      count: proposals.length,
      activeProposal,
      proposals
    });
  }

  getActiveProposal(req, res) {
    const proposal = consensusService.getActiveProposal();
    res.status(200).json({
      success: true,
      proposal
    });
  }

  getProposalById(req, res) {
    const proposal = consensusService.getProposalById(req.params.id);
    if (!proposal) {
      return res.status(404).json({
        success: false,
        code: 'PROPOSAL_NOT_FOUND',
        message: `Proposal '${req.params.id}' not found`
      });
    }
    res.status(200).json({
      success: true,
      proposal
    });
  }

  async voteOnProposal(req, res, next) {
    try {
      const proposalId = req.params.id || req.body.proposalId || 'active';
      const voteInput = {
        ...req.body,
        proposalId: proposalId === 'active' ? undefined : proposalId
      };
      const result = await consensusService.castValidatorVote(voteInput, req.user);
      res.status(200).json({
        success: true,
        message: `Recorded ${result.vote.vote} vote from ${result.vote.shortId} (${result.vote.validatorId}) — ${result.proposal.approvedCount}/${result.proposal.totalValidators} approved`,
        ...result
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          code: err.code || 'VOTE_REJECTED',
          message: err.message,
          conflict: err.conflict || null
        });
      }
      next(err);
    }
  }

  async finalizeProposal(req, res, next) {
    try {
      const proposalId = req.params.id || req.body.proposalId || undefined;
      const result = await consensusService.finalizeProposal(proposalId);
      res.status(200).json({
        success: true,
        message: `Finalized Block #${result.proposal.blockNumber} with ${result.proposal.approvedCount}/${result.proposal.totalValidators} validator approvals`,
        ...result
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          code: err.code || 'FINALIZE_REJECTED',
          message: err.message,
          approvedCount: err.approvedCount !== undefined ? err.approvedCount : undefined,
          rejectedCount: err.rejectedCount !== undefined ? err.rejectedCount : undefined,
          threshold: err.threshold !== undefined ? err.threshold : 9,
          quorumAchieved: false,
          finalized: false,
          failureReasons: err.failureReasons || [],
          proposal: err.proposal || null
        });
      }
      next(err);
    }
  }

  getState(req, res) {
    res.status(200).json({
      success: true,
      state: consensusService.getStateMachineState(),
      history: consensusService.getStateMachineHistory()
    });
  }

  getConflicts(req, res) {
    res.status(200).json({
      success: true,
      conflicts: consensusService.getConflicts()
    });
  }

  getVotesByHeight(req, res) {
    const height = parseInt(req.params.height, 10);
    const votes = consensusService.getVotesByHeight(height);
    res.status(200).json({
      success: true,
      height,
      voteCount: votes.length,
      votes
    });
  }

  getJournal(req, res) {
    const limit = parseInt(req.query.limit, 10) || 50;
    res.status(200).json({
      success: true,
      entries: consensusService.getJournalEntries(limit)
    });
  }

  getLatestRound(req, res) {
    const round = consensusService.getLatestRound();
    res.status(200).json({
      success: true,
      round
    });
  }

  getRoundByTransaction(req, res) {
    const txId = req.params.txId;
    const round = consensusService.getRoundByTransactionId(txId);
    if (!round) {
      return res.status(404).json({
        success: false,
        message: `Consensus round for transaction ${txId} not found`
      });
    }
    res.status(200).json({
      success: true,
      round
    });
  }
}

module.exports = new ConsensusController();


