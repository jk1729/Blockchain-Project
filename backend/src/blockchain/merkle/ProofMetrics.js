/**
 * PDSChain Proof Metrics & Observability (Phase 16)
 * 
 * Tracks proof generation, standalone verification, indexing, and Prometheus telemetry.
 */

class ProofMetrics {
  constructor() {
    this.counters = {
      proofRequestsTotal: 0,
      proofsGeneratedTotal: 0,
      proofsVerifiedTotal: 0,
      validProofsTotal: 0,
      invalidProofsTotal: 0,
      malformedProofsTotal: 0,
      indexHitsTotal: 0,
      indexMissesTotal: 0,
      reindexTotal: 0,
      reindexFailuresTotal: 0,
      rootMismatchesTotal: 0,
      rateLimitRejectionsTotal: 0
    };

    this.latencies = {
      generationTotalMs: 0,
      generationCount: 0,
      verificationTotalMs: 0,
      verificationCount: 0
    };

    this.gauges = {
      lastRebuildTimestamp: null,
      indexedTransactionsCount: 0,
      indexedReceiptsCount: 0,
      indexedEventsCount: 0
    };
  }

  incrementRequests() {
    this.counters.proofRequestsTotal++;
  }

  incrementGenerated(durationMs = 0) {
    this.counters.proofsGeneratedTotal++;
    if (durationMs > 0) {
      this.latencies.generationTotalMs += durationMs;
      this.latencies.generationCount++;
    }
  }

  recordVerification(isValid, durationMs = 0, isMalformed = false) {
    this.counters.proofsVerifiedTotal++;
    if (isValid) {
      this.counters.validProofsTotal++;
    } else {
      this.counters.invalidProofsTotal++;
      if (isMalformed) {
        this.counters.malformedProofsTotal++;
      }
    }
    if (durationMs > 0) {
      this.latencies.verificationTotalMs += durationMs;
      this.latencies.verificationCount++;
    }
  }

  incrementIndexHit() {
    this.counters.indexHitsTotal++;
  }

  incrementIndexMiss() {
    this.counters.indexMissesTotal++;
  }

  incrementReindex(success = true) {
    this.counters.reindexTotal++;
    if (!success) this.counters.reindexFailuresTotal++;
    this.gauges.lastRebuildTimestamp = new Date().toISOString();
  }

  incrementRootMismatch() {
    this.counters.rootMismatchesTotal++;
  }

  incrementRateLimitRejections() {
    this.counters.rateLimitRejectionsTotal++;
  }

  setIndexedCounts(txCount, receiptCount, eventCount) {
    this.gauges.indexedTransactionsCount = txCount;
    this.gauges.indexedReceiptsCount = receiptCount;
    this.gauges.indexedEventsCount = eventCount;
  }

  getSnapshot() {
    const avgGenLatency = this.latencies.generationCount > 0
      ? Number((this.latencies.generationTotalMs / this.latencies.generationCount).toFixed(2))
      : 0;
    const avgVerLatency = this.latencies.verificationCount > 0
      ? Number((this.latencies.verificationTotalMs / this.latencies.verificationCount).toFixed(2))
      : 0;

    return {
      counters: { ...this.counters },
      latencies: {
        avgGenerationLatencyMs: avgGenLatency,
        avgVerificationLatencyMs: avgVerLatency,
        totalGenerationTimeMs: this.latencies.generationTotalMs,
        totalVerificationTimeMs: this.latencies.verificationTotalMs
      },
      gauges: { ...this.gauges }
    };
  }

  toPrometheusFormat() {
    const s = this.getSnapshot();
    const lines = [
      '# HELP pds_proof_requests_total Total number of proof requests received',
      '# TYPE pds_proof_requests_total counter',
      `pds_proof_requests_total ${s.counters.proofRequestsTotal}`,
      '# HELP pds_proof_generated_total Total number of proofs generated',
      '# TYPE pds_proof_generated_total counter',
      `pds_proof_generated_total ${s.counters.proofsGeneratedTotal}`,
      '# HELP pds_proof_verified_total Total number of proofs verified',
      '# TYPE pds_proof_verified_total counter',
      `pds_proof_verified_total ${s.counters.proofsVerifiedTotal}`,
      '# HELP pds_proof_valid_total Total number of valid proofs verified',
      '# TYPE pds_proof_valid_total counter',
      `pds_proof_valid_total ${s.counters.validProofsTotal}`,
      '# HELP pds_proof_invalid_total Total number of invalid proofs verified',
      '# TYPE pds_proof_invalid_total counter',
      `pds_proof_invalid_total ${s.counters.invalidProofsTotal}`,
      '# HELP pds_proof_malformed_total Total number of malformed proofs verified',
      '# TYPE pds_proof_malformed_total counter',
      `pds_proof_malformed_total ${s.counters.malformedProofsTotal}`,
      '# HELP pds_proof_index_hits_total Total proof indexer hits',
      '# TYPE pds_proof_index_hits_total counter',
      `pds_proof_index_hits_total ${s.counters.indexHitsTotal}`,
      '# HELP pds_proof_index_misses_total Total proof indexer misses',
      '# TYPE pds_proof_index_misses_total counter',
      `pds_proof_index_misses_total ${s.counters.indexMissesTotal}`,
      '# HELP pds_proof_indexed_txs Total indexed transactions for proofs',
      '# TYPE pds_proof_indexed_txs gauge',
      `pds_proof_indexed_txs ${s.gauges.indexedTransactionsCount}`
    ];
    return lines.join('\n') + '\n';
  }
}

module.exports = ProofMetrics;

