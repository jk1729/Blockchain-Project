/**
 * PDSChain Consensus & Blockchain Metrics (Phase 19)
 * 
 * Collects block heights, finalization rates, consensus round latencies,
 * transaction execution/rejection counts, quorum failures, and mempool telemetry.
 */

const { defaultMetricsRegistry } = require('./MetricsRegistry');

class ConsensusMetrics {
  constructor(registry = defaultMetricsRegistry) {
    this.registry = registry;

    // Blockchain Core Metrics
    this.blockHeight = this.registry.registerGauge(
      'pds_blockchain_block_height',
      'Current authoritative finalized blockchain height'
    );

    this.blocksFinalizedTotal = this.registry.registerCounter(
      'pds_blockchain_blocks_finalized_total',
      'Total number of blocks permanently finalized by consensus'
    );

    this.blockValidationFailuresTotal = this.registry.registerCounter(
      'pds_blockchain_block_validation_failures_total',
      'Total blocks rejected during validation by failure reason',
      ['reason']
    );

    this.chainForksDetectedTotal = this.registry.registerCounter(
      'pds_blockchain_chain_forks_detected_total',
      'Total blockchain continuity breaks or conflicting proposals intercepted'
    );

    // Transaction & Mempool Metrics
    this.transactionsSubmittedTotal = this.registry.registerCounter(
      'pds_transactions_submitted_total',
      'Total transactions submitted to node mempool'
    );

    this.transactionsExecutedTotal = this.registry.registerCounter(
      'pds_transactions_executed_total',
      'Total transactions executed on-chain'
    );

    this.transactionsRejectedTotal = this.registry.registerCounter(
      'pds_transactions_rejected_total',
      'Total transactions rejected before or during execution',
      ['reason']
    );

    this.mempoolSize = this.registry.registerGauge(
      'pds_mempool_size',
      'Current number of pending transactions in local mempool'
    );

    this.mempoolRejectionsTotal = this.registry.registerCounter(
      'pds_mempool_rejections_total',
      'Total transactions rejected from mempool by reason',
      ['reason']
    );

    // Consensus Round & Voting Metrics
    this.consensusRoundDuration = this.registry.registerHistogram(
      'pds_consensus_round_duration_seconds',
      'Consensus round elapsed time from proposal to quorum agreement',
      [],
      [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]
    );

    this.blockFinalizationDuration = this.registry.registerHistogram(
      'pds_consensus_block_finalization_seconds',
      'End-to-end block finalization duration in seconds',
      [],
      [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 15]
    );

    this.consensusRoundTimeoutsTotal = this.registry.registerCounter(
      'pds_consensus_round_timeouts_total',
      'Total consensus rounds that timed out triggering round advancement'
    );

    this.consensusVotesTotal = this.registry.registerCounter(
      'pds_consensus_votes_total',
      'Total consensus votes cast or received by result',
      ['result']
    );

    this.quorumFailuresTotal = this.registry.registerCounter(
      'pds_consensus_quorum_failures_total',
      'Total consensus rounds failing to reach quorum threshold'
    );
  }

  setBlockHeight(height) {
    this.blockHeight.set(Math.max(0, height));
  }

  recordBlockFinalization(durationSec = 0) {
    this.blocksFinalizedTotal.inc();
    if (durationSec > 0) {
      this.blockFinalizationDuration.observe(durationSec);
    }
  }

  recordBlockValidationFailure(reason = 'INVALID_HEADER') {
    const safeReason = String(reason).slice(0, 32).toUpperCase();
    this.blockValidationFailuresTotal.inc({ reason: safeReason });
  }

  recordChainFork() {
    this.chainForksDetectedTotal.inc();
  }

  recordTxSubmission(count = 1) {
    this.transactionsSubmittedTotal.inc({}, count);
  }

  recordTxExecution(count = 1) {
    this.transactionsExecutedTotal.inc({}, count);
  }

  recordTxRejection(reason = 'UNKNOWN', count = 1) {
    const safeReason = String(reason).slice(0, 32).toUpperCase();
    this.transactionsRejectedTotal.inc({ reason: safeReason }, count);
  }

  setMempoolSize(count) {
    this.mempoolSize.set(Math.max(0, count));
  }

  recordMempoolRejection(reason = 'CAPACITY_EXCEEDED') {
    const safeReason = String(reason).slice(0, 32).toUpperCase();
    this.mempoolRejectionsTotal.inc({ reason: safeReason });
  }

  recordRoundDuration(durationSec) {
    this.consensusRoundDuration.observe(Math.max(0, durationSec));
  }

  recordRoundTimeout() {
    this.consensusRoundTimeoutsTotal.inc();
  }

  recordVote(result = 'ACCEPT') {
    const safeResult = String(result).slice(0, 16).toUpperCase();
    this.consensusVotesTotal.inc({ result: safeResult });
  }

  recordQuorumFailure() {
    this.quorumFailuresTotal.inc();
  }
}

const defaultConsensusMetrics = new ConsensusMetrics();

module.exports = {
  ConsensusMetrics,
  defaultConsensusMetrics
};

