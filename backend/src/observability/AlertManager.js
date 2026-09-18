/**
 * PDSChain In-Memory Alert Manager (Phase 19)
 * 
 * Evaluates Prometheus alert expressions against current in-memory metrics
 * and exposes active alert statuses to operators and health systems.
 */

const ALERT_RULES = [
  {
    id: 'HighHttp5xxRate',
    name: 'Elevated HTTP 5xx Server Error Rate',
    severity: 'critical',
    routing: 'page',
    evaluate: (m) => (m.httpErrorsTotal || 0) > 20
  },
  {
    id: 'ConsensusStalled',
    name: 'Blockchain Consensus Engine Stalled',
    severity: 'critical',
    routing: 'page',
    evaluate: (m) => (m.consensusRoundTimeouts || 0) > 5
  },
  {
    id: 'DatabasePoolExhausted',
    name: 'Database Connection Pool Exhausted',
    severity: 'critical',
    routing: 'page',
    evaluate: (m) => (m.poolActiveConnections || 0) >= (m.poolMaxConnections || 20)
  },
  {
    id: 'DatabaseIntegrityFailure',
    name: 'Ledger Integrity Verification Failed',
    severity: 'critical',
    routing: 'page',
    evaluate: (m) => (m.integrityErrorsTotal || 0) > 0
  },
  {
    id: 'BreakGlassEmergencyActivated',
    name: 'Break-Glass Emergency Operator Override Activated',
    severity: 'critical',
    routing: 'page',
    evaluate: (m) => (m.breakGlassActivations || 0) > 0
  },
  {
    id: 'NodeMemoryPressure',
    name: 'Node.js V8 Heap Memory Pressure',
    severity: 'warning',
    routing: 'ticket',
    evaluate: (m) => (m.heapUsedBytes || 0) > 1.2 * 1024 * 1024 * 1024
  },
  {
    id: 'EventLoopLagElevated',
    name: 'Elevated Node.js Event Loop Lag',
    severity: 'warning',
    routing: 'ticket',
    evaluate: (m) => (m.eventLoopLagSeconds || 0) > 0.1
  }
];

class AlertManager {
  constructor(rules = ALERT_RULES) {
    this.rules = rules;
  }

  /**
   * Evaluate all alert rules against a metric telemetry snapshot
   * @param {object} metricSnapshot 
   * @returns {Array<object>}
   */
  evaluate(metricSnapshot = {}) {
    const results = [];
    const now = new Date().toISOString();

    for (const rule of this.rules) {
      const isFiring = Boolean(rule.evaluate(metricSnapshot));
      results.push({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        routing: rule.routing,
        status: isFiring ? 'FIRING' : 'OK',
        activeSince: isFiring ? now : null
      });
    }

    return results;
  }

  getFiringAlerts(metricSnapshot = {}) {
    return this.evaluate(metricSnapshot).filter(a => a.status === 'FIRING');
  }
}

const defaultAlertManager = new AlertManager();

module.exports = {
  ALERT_RULES,
  AlertManager,
  defaultAlertManager
};

