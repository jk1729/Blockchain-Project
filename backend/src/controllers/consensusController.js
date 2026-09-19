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

