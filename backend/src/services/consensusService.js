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
}

module.exports = new ConsensusService();
