/**
 * Phase 19: Consensus & Node.js Runtime Metrics Test Suite
 */

const { ConsensusMetrics } = require('../src/observability/ConsensusMetrics');
const { RuntimeMetrics } = require('../src/observability/RuntimeMetrics');
const { MetricsRegistry } = require('../src/observability/MetricsRegistry');

describe('Phase 19: Consensus & Node.js Runtime Metrics', () => {
  let registry;
  let consensusMetrics;
  let runtimeMetrics;

  beforeEach(() => {
    registry = new MetricsRegistry();
    consensusMetrics = new ConsensusMetrics(registry);
    runtimeMetrics = new RuntimeMetrics(registry);
  });

  afterEach(() => {
    runtimeMetrics.stopSampling();
  });

  describe('1. Consensus & Blockchain Metrics', () => {
    test('should track block height, finalization events, and finalization durations', () => {
      consensusMetrics.setBlockHeight(1055);
      expect(consensusMetrics.blockHeight.get()).toBe(1055);

      consensusMetrics.recordBlockFinalization(0.25);
      consensusMetrics.recordBlockFinalization(0.40);
      expect(consensusMetrics.blocksFinalizedTotal.get()).toBe(2);

      const hist = consensusMetrics.blockFinalizationDuration.get();
      expect(hist.count).toBe(2);
      expect(hist.sum).toBeCloseTo(0.65, 2);
    });

    test('should record block validation failures, chain forks, and quorum failures', () => {
      consensusMetrics.recordBlockValidationFailure('INVALID_PREVIOUS_HASH');
      consensusMetrics.recordChainFork();
      consensusMetrics.recordQuorumFailure();

      expect(consensusMetrics.blockValidationFailuresTotal.get({ reason: 'INVALID_PREVIOUS_HASH' })).toBe(1);
      expect(consensusMetrics.chainForksDetectedTotal.get()).toBe(1);
      expect(consensusMetrics.quorumFailuresTotal.get()).toBe(1);
    });

    test('should track transaction execution lifecycle and mempool depth', () => {
      consensusMetrics.recordTxSubmission(10);
      consensusMetrics.recordTxExecution(8);
      consensusMetrics.recordTxRejection('INSUFFICIENT_FUNDS', 2);
      consensusMetrics.setMempoolSize(25);
      consensusMetrics.recordMempoolRejection('MEMPOOL_FULL');

      expect(consensusMetrics.transactionsSubmittedTotal.get()).toBe(10);
      expect(consensusMetrics.transactionsExecutedTotal.get()).toBe(8);
      expect(consensusMetrics.transactionsRejectedTotal.get({ reason: 'INSUFFICIENT_FUNDS' })).toBe(2);
      expect(consensusMetrics.mempoolSize.get()).toBe(25);
      expect(consensusMetrics.mempoolRejectionsTotal.get({ reason: 'MEMPOOL_FULL' })).toBe(1);
    });

    test('should record consensus votes and round timeouts', () => {
      consensusMetrics.recordVote('ACCEPT');
      consensusMetrics.recordVote('ACCEPT');
      consensusMetrics.recordVote('REJECT');
      consensusMetrics.recordRoundTimeout();

      expect(consensusMetrics.consensusVotesTotal.get({ result: 'ACCEPT' })).toBe(2);
      expect(consensusMetrics.consensusVotesTotal.get({ result: 'REJECT' })).toBe(1);
      expect(consensusMetrics.consensusRoundTimeoutsTotal.get()).toBe(1);
    });
  });

  describe('2. Node.js Runtime & Resource Metrics', () => {
    test('sample should populate process uptime, heap memory, and RSS gauges', () => {
      runtimeMetrics.sample();

      expect(runtimeMetrics.processUptimeSeconds.get()).toBeGreaterThanOrEqual(0);
      expect(runtimeMetrics.heapUsedBytes.get()).toBeGreaterThan(0);
      expect(runtimeMetrics.heapTotalBytes.get()).toBeGreaterThan(0);
      expect(runtimeMetrics.rssBytes.get()).toBeGreaterThan(0);
    });

    test('startSampling and stopSampling should manage background timer safely', (done) => {
      runtimeMetrics.startSampling(50);
      expect(runtimeMetrics.timer).not.toBeNull();

      setTimeout(() => {
        runtimeMetrics.stopSampling();
        expect(runtimeMetrics.timer).toBeNull();
        done();
      }, 120);
    });
  });
});

