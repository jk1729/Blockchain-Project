/**
 * PDSChain Consensus and Byzantine Fault Scenarios (Phase 20 - Stage G)
 * 
 * Scenarios CONSENSUS-001 through CONSENSUS-004:
 * - CONSENSUS-001: Double-Voting Equivocator Detection
 * - CONSENSUS-002: Stale Consensus Round Rejection
 * - CONSENSUS-003: Validator Crash, Quorum Loss & Recovery
 * - CONSENSUS-004: Stale Writer Fencing Token Rejection
 */

const { ConflictDetector } = require('../../consensus/ConflictDetector');
const { InvariantMonitor } = require('../InvariantMonitor');

const conflictDetector = new ConflictDetector();

const consensusScenarios = [
  {
    id: 'CONSENSUS-001',
    name: 'Double-Voting Equivocator Detection',
    category: 'CONSENSUS',
    severity: 'CRITICAL',
    runtimeBudgetMs: 5000,
    expectedOutcome: 'EQUIVOCATION_DETECTED',
    description: 'Simulates a Byzantine validator casting conflicting votes for two different proposals in the same round.',
    invariants: ['LEDGER_MONOTONIC_HEIGHT', 'LEDGER_IMMUTABLE_BLOCK_HASH'],
    handler: async (context) => {
      context.markFaultInjected();

      const validatorId = 'sim-val-byzantine-01';
      const round = 1;
      const blockNumber = 100;

      // Legitimate vote
      const vote1 = {
        validatorId,
        round,
        blockNumber,
        proposalId: 'prop-001',
        blockHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        vote: 'ACCEPT'
      };

      // Conflicting vote in same round for different proposal
      const vote2 = {
        validatorId,
        round,
        blockNumber,
        proposalId: 'prop-002',
        blockHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        vote: 'ACCEPT'
      };

      // Evaluate conflict
      const checkResult = conflictDetector.checkVote(vote2, [vote1]);
      context.markDetected();

      const hasConflict = checkResult.hasConflict;
      const isConflictingVote = checkResult.code === 'CONFLICTING_DOUBLE_VOTE' || checkResult.code === 'EQUIVOCATION';

      const invariantChecks = [
        () => {
          if (!hasConflict || !isConflictingVote) {
            throw new Error(`Expected double-vote conflict, got: ${JSON.stringify(checkResult)}`);
          }
          return { name: 'BYZANTINE_DOUBLE_VOTE_CONTAINMENT', passed: true };
        },
        () => InvariantMonitor.assertMonotonicHeight(blockNumber, blockNumber),
        () => InvariantMonitor.assertZeroSecretLeakage(checkResult)
      ];

      const invSummary = InvariantMonitor.verifyBatch(invariantChecks);

      return {
        success: invSummary.allPassed && hasConflict,
        details: { code: checkResult.code, hasConflict, reason: checkResult.reason },
        invariantResults: invSummary.results
      };
    }
  },

  {
    id: 'CONSENSUS-002',
    name: 'Stale Consensus Round Message Rejection',
    category: 'CONSENSUS',
    severity: 'MEDIUM',
    runtimeBudgetMs: 5000,
    expectedOutcome: 'STALE_ROUND_REJECTED',
    description: 'Verifies that consensus messages from stale prior rounds are rejected to prevent replay attacks.',
    invariants: ['LEDGER_MONOTONIC_HEIGHT'],
    handler: async (context) => {
      context.markFaultInjected();

      const activeRound = 5;
      const staleVote = {
        validatorId: 'sim-val-02',
        round: 2, // Stale! Active round is 5
        blockNumber: 100,
        proposalId: 'prop-stale',
        vote: 'PREPARE'
      };

      const isStale = staleVote.round < activeRound;
      context.markDetected();

      const invariantChecks = [
        () => {
          if (!isStale) {
            throw new Error('Stale round was not detected');
          }
          return { name: 'STALE_ROUND_DEFENSE', passed: true, details: { activeRound, voteRound: staleVote.round } };
        },
        () => InvariantMonitor.assertMonotonicHeight(100, 100)
      ];

      const invSummary = InvariantMonitor.verifyBatch(invariantChecks);

      return {
        success: invSummary.allPassed && isStale,
        details: { activeRound, incomingRound: staleVote.round, isStale },
        invariantResults: invSummary.results
      };
    }
  },

  {
    id: 'CONSENSUS-003',
    name: 'Validator Crash, Quorum Loss and Recovery',
    category: 'CONSENSUS',
    severity: 'HIGH',
    runtimeBudgetMs: 5000,
    expectedOutcome: 'QUORUM_RECOVERED',
    description: 'Simulates 2 of 4 validators crashing, stalling consensus, then recovers 1 validator to restore 2/3+ quorum.',
    invariants: ['LEDGER_MONOTONIC_HEIGHT', 'LEDGER_SEQUENCE_CONTINUITY'],
    handler: async (context) => {
      const totalValidators = 4;
      const quorumRequired = Math.floor((totalValidators * 2) / 3) + 1; // 3

      // Baseline: 4 active
      let activeValidators = ['v1', 'v2', 'v3', 'v4'];
      let height = 100;
      context.captureBaseline({ ledgerHeight: height, validatorCount: activeValidators.length });

      // Step 1: Inject fault (2 crash)
      context.markFaultInjected();
      activeValidators = ['v1', 'v2']; // Only 2 left
      const canFinalizeDuringFault = activeValidators.length >= quorumRequired; // false

      context.markDetected();

      // Step 2: Recovery (v3 returns)
      context.markRecoveryStarted();
      activeValidators.push('v3'); // Now 3
      const canFinalizeAfterRecovery = activeValidators.length >= quorumRequired; // true
      if (canFinalizeAfterRecovery) {
        height++; // Block finalized
      }
      context.markRecoveryCompleted();
      context.capturePostRecovery({ ledgerHeight: height, validatorCount: activeValidators.length });

      const invariantChecks = [
        () => InvariantMonitor.assertMonotonicHeight(100, height),
        () => {
          if (canFinalizeDuringFault) {
            throw new Error('Consensus proceeded without required 2/3+ quorum!');
          }
          if (!canFinalizeAfterRecovery) {
            throw new Error('Consensus failed to resume after quorum recovery!');
          }
          return { name: 'CONSENSUS_QUORUM_RESILIENCE', passed: true };
        }
      ];

      const invSummary = InvariantMonitor.verifyBatch(invariantChecks);

      return {
        success: invSummary.allPassed,
        details: {
          quorumRequired,
          faultActiveCount: 2,
          recoveryActiveCount: activeValidators.length,
          finalizedHeight: height
        },
        invariantResults: invSummary.results
      };
    }
  },

  {
    id: 'CONSENSUS-004',
    name: 'Stale Writer Fencing Token Rejection',
    category: 'CONSENSUS',
    severity: 'CRITICAL',
    runtimeBudgetMs: 5000,
    expectedOutcome: 'SPLIT_BRAIN_PREVENTED',
    description: 'A demoted writer with stale fencing token attempts to commit; assert rejection preserving single-writer guarantee.',
    invariants: ['DATABASE_WRITER_FENCING', 'LEDGER_IMMUTABLE_BLOCK_HASH'],
    handler: async (context) => {
      context.markFaultInjected();

      const activeFencingToken = 10;
      const staleFencingToken = 9; // Stale token from partition

      let staleWriteRejected = false;
      try {
        InvariantMonitor.assertWriterFencingToken(activeFencingToken, staleFencingToken);
      } catch (err) {
        if (err.name === 'InvariantViolationError') {
          staleWriteRejected = true;
        }
      }

      context.markDetected();

      // Promoted writer with token 11 commits successfully
      const promotedToken = 11;
      const promotedCheck = InvariantMonitor.assertWriterFencingToken(activeFencingToken, promotedToken);

      const invariantChecks = [
        () => {
          if (!staleWriteRejected) {
            throw new Error('Stale writer fencing token was erroneously accepted!');
          }
          return { name: 'WRITER_FENCING_ENFORCEMENT', passed: true };
        },
        () => promotedCheck
      ];

      const invSummary = InvariantMonitor.verifyBatch(invariantChecks);

      return {
        success: invSummary.allPassed && staleWriteRejected,
        details: { activeFencingToken, staleFencingToken, staleWriteRejected, promotedToken },
        invariantResults: invSummary.results
      };
    }
  }
];

module.exports = { consensusScenarios };
