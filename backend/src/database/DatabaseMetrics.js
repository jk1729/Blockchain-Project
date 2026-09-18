/**
 * PDSChain Database Metrics Collector (Phase 18)
 * 
 * Collects database performance, connection pool utilization, commit/rollback counts,
 * integrity check results, and formats Prometheus metrics.
 */

class DatabaseMetrics {
  constructor() {
    this.commitsTotal = 0;
    this.rollbacksTotal = 0;
    this.deadlocksTotal = 0;
    this.integrityChecksTotal = 0;
    this.integrityErrorsTotal = 0;
    this.queryDurations = [];
    this.poolActive = 0;
    this.poolMax = 20;
  }

  recordCommit() {
    this.commitsTotal++;
  }

  recordRollback() {
    this.rollbacksTotal++;
  }

  recordDeadlock() {
    this.deadlocksTotal++;
  }

  recordIntegrityCheck(isValid) {
    this.integrityChecksTotal++;
    if (!isValid) {
      this.integrityErrorsTotal++;
    }
  }

  recordQueryDuration(ms) {
    this.queryDurations.push(ms);
    if (this.queryDurations.length > 500) {
      this.queryDurations.shift();
    }
  }

  updatePoolUsage(active, max) {
    this.poolActive = active;
    this.poolMax = max;
  }

  getSnapshot() {
    const avgLatency = this.queryDurations.length > 0
      ? this.queryDurations.reduce((a, b) => a + b, 0) / this.queryDurations.length
      : 0;

    return {
      commitsTotal: this.commitsTotal,
      rollbacksTotal: this.rollbacksTotal,
      deadlocksTotal: this.deadlocksTotal,
      integrityChecksTotal: this.integrityChecksTotal,
      integrityErrorsTotal: this.integrityErrorsTotal,
      averageQueryDurationMs: parseFloat(avgLatency.toFixed(2)),
      poolActiveConnections: this.poolActive,
      poolMaxConnections: this.poolMax
    };
  }

  exportPrometheusMetrics() {
    const lines = [
      '# HELP pds_database_commits_total Total database transaction commits.',
      '# TYPE pds_database_commits_total counter',
      `pds_database_commits_total ${this.commitsTotal}`,
      '',
      '# HELP pds_database_rollbacks_total Total database transaction rollbacks.',
      '# TYPE pds_database_rollbacks_total counter',
      `pds_database_rollbacks_total ${this.rollbacksTotal}`,
      '',
      '# HELP pds_database_deadlocks_total Total database deadlocks detected.',
      '# TYPE pds_database_deadlocks_total counter',
      `pds_database_deadlocks_total ${this.deadlocksTotal}`,
      '',
      '# HELP pds_database_integrity_checks_total Total ledger integrity audits executed.',
      '# TYPE pds_database_integrity_checks_total counter',
      `pds_database_integrity_checks_total ${this.integrityChecksTotal}`,
      '',
      '# HELP pds_database_integrity_errors_total Total ledger integrity errors caught.',
      '# TYPE pds_database_integrity_errors_total counter',
      `pds_database_integrity_errors_total ${this.integrityErrorsTotal}`,
      '',
      '# HELP pds_database_connections_active Number of active connections in pool.',
      '# TYPE pds_database_connections_active gauge',
      `pds_database_connections_active ${this.poolActive}`,
      '',
      '# HELP pds_database_connections_max Maximum connections configured for pool.',
      '# TYPE pds_database_connections_max gauge',
      `pds_database_connections_max ${this.poolMax}`
    ];
    return lines.join('\n');
  }
}

const defaultDatabaseMetrics = new DatabaseMetrics();

module.exports = {
  DatabaseMetrics,
  defaultDatabaseMetrics
};

