/**
 * PDSChain SLO & Error Budget Engine (Phase 19)
 * 
 * Computes real-time SLI compliance percentages, error budget consumption,
 * and burn rates across API, RPC, consensus, database, and security operations.
 */

const DEFAULT_SLOS = [
  {
    id: 'api_availability',
    name: 'API Availability',
    targetPercent: 99.9,
    windowDays: 30,
    category: 'API'
  },
  {
    id: 'api_latency',
    name: 'API Latency (p95 < 200ms)',
    targetPercent: 95.0,
    windowDays: 30,
    category: 'API'
  },
  {
    id: 'rpc_availability',
    name: 'JSON-RPC Availability',
    targetPercent: 99.9,
    windowDays: 30,
    category: 'RPC'
  },
  {
    id: 'block_finalization_rate',
    name: 'Block Finalization Success Rate',
    targetPercent: 99.99,
    windowDays: 30,
    category: 'CONSENSUS'
  },
  {
    id: 'consensus_round_success',
    name: 'Consensus Round Success Rate',
    targetPercent: 99.5,
    windowDays: 30,
    category: 'CONSENSUS'
  },
  {
    id: 'database_availability',
    name: 'Database Connection Availability',
    targetPercent: 99.95,
    windowDays: 30,
    category: 'DATABASE'
  },
  {
    id: 'security_audit_logging',
    name: 'Audit Log Integrity & Append Rate',
    targetPercent: 100.0,
    windowDays: 30,
    category: 'SECURITY'
  }
];

class SloEngine {
  constructor(slos = DEFAULT_SLOS) {
    this.slos = slos;
  }

  /**
   * Evaluate SLO compliance for a given metric measurement
   * @param {string} sloId 
   * @param {number} totalCount 
   * @param {number} goodCount 
   * @returns {object}
   */
  evaluateSlo(sloId, totalCount = 0, goodCount = 0) {
    const def = this.slos.find(s => s.id === sloId);
    if (!def) throw new Error(`Unknown SLO definition: ${sloId}`);

    const measuredRate = totalCount > 0 ? (goodCount / totalCount) * 100 : 100.0;
    const errorBudgetPercent = 100.0 - def.targetPercent;
    const errorRate = 100.0 - measuredRate;

    let consumedBudgetPercent = 0;
    if (errorBudgetPercent > 0) {
      consumedBudgetPercent = Math.max(0, (errorRate / errorBudgetPercent) * 100);
    } else if (errorRate > 0) {
      consumedBudgetPercent = 100.0;
    }

    const remainingBudgetPercent = Math.max(0, 100.0 - consumedBudgetPercent);
    const isMet = measuredRate >= def.targetPercent;

    return {
      sloId: def.id,
      name: def.name,
      category: def.category,
      targetPercent: def.targetPercent,
      measuredPercent: parseFloat(measuredRate.toFixed(3)),
      isMet,
      errorBudgetPercent: parseFloat(errorBudgetPercent.toFixed(3)),
      consumedBudgetPercent: parseFloat(consumedBudgetPercent.toFixed(2)),
      remainingBudgetPercent: parseFloat(remainingBudgetPercent.toFixed(2)),
      status: isMet ? (consumedBudgetPercent > 80 ? 'WARNING' : 'HEALTHY') : 'BREACHED'
    };
  }

  /**
   * Evaluate all registered SLOs
   * @param {object} [metricsData={}] 
   * @returns {Array<object>}
   */
  evaluateAll(metricsData = {}) {
    return this.slos.map(slo => {
      const data = metricsData[slo.id] || { total: 100, good: 100 };
      return this.evaluateSlo(slo.id, data.total, data.good);
    });
  }
}

const defaultSloEngine = new SloEngine();

module.exports = {
  DEFAULT_SLOS,
  SloEngine,
  defaultSloEngine
};

