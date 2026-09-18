const fbaInstance = require('../consensus/FBAConsensus');

class ConsensusService {
  getStatus() {
    return fbaInstance.getNetworkStatus();
  }

  getQuorumDetails() {
    const nodes = fbaInstance.getValidators();
    const networkStatus = fbaInstance.getNetworkStatus();

    const slices = nodes.map(n => ({
      validatorId: n.validatorId,
      name: n.name,
      org: n.org,
      status: n.status,
      trustConfiguration: n.quorumSlice.toJSON()
    }));

    return {
      networkStatus,
      slices,
      recentRounds: fbaInstance.rounds.slice(0, 10)
    };
  }

  async runConsensus(proposal, options = {}) {
    return await fbaInstance.runConsensusRound(proposal, options);
  }

  async runBlockConsensus(candidateBlock, options = {}) {
    return await fbaInstance.runBlockConsensus(candidateBlock, options);
  }

  verifyCertificate(certificate, block) {
    return fbaInstance.verifyCertificate(certificate, block);
  }

  getStateMachineState() {
    return fbaInstance.getStateMachine().toJSON();
  }

  getStateMachineHistory() {
    return fbaInstance.getStateMachine().getHistory();
  }

  getConflicts() {
    return fbaInstance.voteStore.getConflicts();
  }

  getVotesByHeight(height) {
    const votes = fbaInstance.voteStore.getVotesByHeight(height);
    return votes.map(v => (v.toJSON ? v.toJSON() : v));
  }

  getJournalEntries(limit = 50) {
    const entries = fbaInstance.getJournal().getEntries();
    return entries.slice(-limit);
  }
}

module.exports = new ConsensusService();
