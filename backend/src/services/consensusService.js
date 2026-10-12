const fbaInstance = require('../consensus/FBAConsensus');
const { getShortValidatorId } = require('../consensus/consensusConfig');

class ConsensusService {
  getStatus() {
    return fbaInstance.getNetworkStatus();
  }

  getQuorumDetails() {
    const nodes = fbaInstance.getValidators();
    const networkStatus = fbaInstance.getNetworkStatus();

    const slices = nodes.map(n => ({
      validatorId: n.validatorId,
      shortId: n.shortId || getShortValidatorId(n.validatorId),
      name: n.name,
      org: n.org,
      status: n.status,
      trustConfiguration: n.quorumSlice.toJSON()
    }));

    return {
      networkStatus,
      slices,
      recentRounds: fbaInstance.rounds.slice(0, 10),
      activeProposal: fbaInstance.getActiveProposal()
    };
  }

  async runConsensus(proposal, options = {}) {
    return await fbaInstance.runConsensusRound(proposal, options);
  }

  async runBlockConsensus(candidateBlock, options = {}) {
    return await fbaInstance.runBlockConsensus(candidateBlock, options);
  }

  async createPendingProposal(payload = {}, options = {}) {
    return await fbaInstance.createPendingProposal(payload, options);
  }

  getAllProposals() {
    return fbaInstance.getAllProposals();
  }

  getActiveProposal() {
    return fbaInstance.getActiveProposal();
  }

  getProposalById(proposalId) {
    return fbaInstance.getProposalById(proposalId);
  }

  async castValidatorVote(voteInput = {}, authenticatedUser = null) {
    return await fbaInstance.castValidatorVote(voteInput, authenticatedUser);
  }

  async finalizeProposal(proposalId) {
    return await fbaInstance.finalizeProposal(proposalId);
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

  getLatestRound() {
    return fbaInstance.getLatestRound();
  }

  getRoundByTransactionId(txId) {
    return fbaInstance.getRoundByTransactionId(txId);
  }
}

module.exports = new ConsensusService();

