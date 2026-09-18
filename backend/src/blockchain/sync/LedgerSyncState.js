/**
 * PDSChain Ledger Synchronization State Machine (Phase 10)
 * 
 * Enforces strict, deterministic lifecycle transitions for ledger synchronization,
 * health observability, and consensus participation gating.
 */

const SyncStatus = Object.freeze({
  BOOTSTRAPPING: 'BOOTSTRAPPING',
  SYNCING: 'SYNCING',
  VERIFYING: 'VERIFYING',
  CATCHING_UP: 'CATCHING_UP',
  CURRENT: 'CURRENT',
  DEGRADED: 'DEGRADED',
  RECOVERY_REQUIRED: 'RECOVERY_REQUIRED',
  CORRUPTED: 'CORRUPTED',
  HALTED: 'HALTED'
});

/**
 * Valid state transitions mapping
 */
const VALID_TRANSITIONS = {
  [SyncStatus.BOOTSTRAPPING]: [
    SyncStatus.SYNCING,
    SyncStatus.VERIFYING,
    SyncStatus.CURRENT,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.CORRUPTED,
    SyncStatus.HALTED
  ],
  [SyncStatus.SYNCING]: [
    SyncStatus.VERIFYING,
    SyncStatus.CATCHING_UP,
    SyncStatus.DEGRADED,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.HALTED
  ],
  [SyncStatus.VERIFYING]: [
    SyncStatus.CATCHING_UP,
    SyncStatus.CURRENT,
    SyncStatus.SYNCING,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.CORRUPTED,
    SyncStatus.HALTED
  ],
  [SyncStatus.CATCHING_UP]: [
    SyncStatus.VERIFYING,
    SyncStatus.CURRENT,
    SyncStatus.SYNCING,
    SyncStatus.DEGRADED,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.HALTED
  ],
  [SyncStatus.CURRENT]: [
    SyncStatus.SYNCING,
    SyncStatus.CATCHING_UP,
    SyncStatus.DEGRADED,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.CORRUPTED,
    SyncStatus.HALTED
  ],
  [SyncStatus.DEGRADED]: [
    SyncStatus.SYNCING,
    SyncStatus.VERIFYING,
    SyncStatus.CURRENT,
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.HALTED
  ],
  [SyncStatus.RECOVERY_REQUIRED]: [
    SyncStatus.BOOTSTRAPPING,
    SyncStatus.SYNCING,
    SyncStatus.VERIFYING,
    SyncStatus.CORRUPTED,
    SyncStatus.HALTED
  ],
  [SyncStatus.CORRUPTED]: [
    SyncStatus.RECOVERY_REQUIRED,
    SyncStatus.HALTED
  ],
  [SyncStatus.HALTED]: [
    SyncStatus.BOOTSTRAPPING // Explicit operator / supervisor reset only
  ]
};

class LedgerSyncState {
  /**
   * @param {object} [options]
   * @param {string} [options.validatorId='VAL-01']
   * @param {string} [options.initialState=SyncStatus.BOOTSTRAPPING]
   */
  constructor(options = {}) {
    this.validatorId = options.validatorId || 'VAL-01';
    this.state = options.initialState || SyncStatus.BOOTSTRAPPING;
    this.stateHistory = [
      { state: this.state, timestamp: new Date().toISOString(), reason: 'Initial initialization' }
    ];

    // Core height tracking
    this.localFinalizedHeight = 0;
    this.localCommittedHeight = 0;
    this.latestBlockHash = '0000000000000000000000000000000000000000000000000000000000000000';
    this.targetHeight = 0;
    this.syncStartHeight = 0;

    // Progress & batch tracking
    this.currentBatch = null;
    this.blocksProcessedInBatch = 0;
    this.totalBlocksSynced = 0;

    // Peer height tracking: validatorId -> height
    this.trustedPeerHeights = new Map();

    // Diagnostics & timestamps
    this.lastSuccessfulSyncAt = null;
    this.lastFailedSyncAt = null;
    this.retriesCount = 0;
    this.maxRetries = options.maxRetries || 5;
    this.recoveryReason = null;

    // Derived state verification status
    this.verificationStatus = 'UNVERIFIED'; // 'UNVERIFIED' | 'IN_PROGRESS' | 'PASSED' | 'FAILED'
    this.stateRootStatus = 'PENDING';       // 'PENDING' | 'VALID' | 'MISMATCH'
    this.receiptRootStatus = 'PENDING';     // 'PENDING' | 'VALID' | 'MISMATCH'
    this.journalReplayStatus = 'PENDING';   // 'PENDING' | 'REPLAYED' | 'FAILED'
  }

  /**
   * Check if an explicit state transition is valid
   * @param {string} targetState 
   * @returns {boolean}
   */
  canTransitionTo(targetState) {
    if (!SyncStatus[targetState]) return false;
    const allowed = VALID_TRANSITIONS[this.state] || [];
    return allowed.includes(targetState);
  }

  /**
   * Transition to next state with safety invariants validation
   * @param {string} targetState 
   * @param {string} [reason=null] 
   */
  transitionTo(targetState, reason = null) {
    if (!SyncStatus[targetState]) {
      throw new Error(`[LedgerSyncState] Invalid target sync state: '${targetState}'`);
    }

    if (!this.canTransitionTo(targetState)) {
      throw new Error(`[LedgerSyncState] Illegal state transition from ${this.state} to ${targetState}`);
    }

    // Strict safety invariant: cannot transition to CURRENT unless local ledger is verified and caught up
    if (targetState === SyncStatus.CURRENT) {
      if (this.verificationStatus !== 'PASSED') {
        throw new Error(`[LedgerSyncState] Invariant violation: cannot transition to CURRENT while verificationStatus is '${this.verificationStatus}'`);
      }
      if (this.targetHeight > 0 && this.localFinalizedHeight < this.targetHeight) {
        throw new Error(`[LedgerSyncState] Invariant violation: local height (${this.localFinalizedHeight}) is behind target (${this.targetHeight})`);
      }
      if (this.stateRootStatus === 'MISMATCH') {
        throw new Error(`[LedgerSyncState] Invariant violation: cannot transition to CURRENT with stateRoot mismatch`);
      }
    }

    const previousState = this.state;
    this.state = targetState;
    if (reason) {
      this.recoveryReason = reason;
    }

    this.stateHistory.push({
      from: previousState,
      to: targetState,
      timestamp: new Date().toISOString(),
      reason: reason || 'Normal state advancement'
    });

    // Prune history to last 50 transitions
    if (this.stateHistory.length > 50) {
      this.stateHistory.shift();
    }

    return this.state;
  }

  /**
   * Only in CURRENT state may a validator participate in consensus (propose or vote)
   * @returns {boolean}
   */
  isConsensusReady() {
    return this.state === SyncStatus.CURRENT && this.verificationStatus === 'PASSED';
  }

  isSyncing() {
    return [SyncStatus.SYNCING, SyncStatus.VERIFYING, SyncStatus.CATCHING_UP].includes(this.state);
  }

  isHalted() {
    return [SyncStatus.HALTED, SyncStatus.CORRUPTED, SyncStatus.RECOVERY_REQUIRED].includes(this.state);
  }

  setPeerHeight(peerValidatorId, height) {
    if (!peerValidatorId) return;
    const parsed = Math.max(0, parseInt(height, 10) || 0);
    this.trustedPeerHeights.set(peerValidatorId, parsed);
  }

  getPeerHeight(peerValidatorId) {
    return this.trustedPeerHeights.get(peerValidatorId) || 0;
  }

  /**
   * Set target height from consensus or peer agreement
   * @param {number} target 
   */
  setTargetHeight(target) {
    this.targetHeight = Math.max(this.targetHeight, parseInt(target, 10) || 0);
  }

  /**
   * Update local finalized state
   * @param {number} height 
   * @param {string} hash 
   */
  setFinalizedState(height, hash) {
    this.localFinalizedHeight = Math.max(0, parseInt(height, 10) || 0);
    if (hash) {
      this.latestBlockHash = String(hash);
    }
  }

  setCommittedHeight(height) {
    this.localCommittedHeight = Math.max(0, parseInt(height, 10) || 0);
  }

  startSyncBatch(batchNumber, startHeight, targetHeight) {
    this.currentBatch = {
      batchNumber,
      startHeight,
      targetHeight,
      startedAt: new Date().toISOString()
    };
    this.syncStartHeight = startHeight;
    this.targetHeight = Math.max(this.targetHeight, targetHeight);
    this.blocksProcessedInBatch = 0;
  }

  recordBlockProcessed() {
    this.blocksProcessedInBatch++;
    this.totalBlocksSynced++;
  }

  recordSyncSuccess() {
    this.lastSuccessfulSyncAt = new Date().toISOString();
    this.retriesCount = 0;
    this.recoveryReason = null;
  }

  recordSyncFailure(reason) {
    this.lastFailedSyncAt = new Date().toISOString();
    this.retriesCount++;
    this.recoveryReason = reason || 'Unknown sync failure';
  }

  getProgressPercentage() {
    if (this.targetHeight <= this.syncStartHeight) {
      return this.localFinalizedHeight >= this.targetHeight ? 100 : 0;
    }
    const totalToSync = this.targetHeight - this.syncStartHeight;
    const synced = Math.max(0, this.localFinalizedHeight - this.syncStartHeight);
    return Math.min(100, Math.floor((synced / totalToSync) * 100));
  }

  getSnapshot() {
    const peerHeightsObj = {};
    for (const [peerId, h] of this.trustedPeerHeights.entries()) {
      peerHeightsObj[peerId] = h;
    }

    return {
      validatorId: this.validatorId,
      state: this.state,
      isConsensusReady: this.isConsensusReady(),
      localFinalizedHeight: this.localFinalizedHeight,
      localCommittedHeight: this.localCommittedHeight,
      latestBlockHash: this.latestBlockHash,
      targetHeight: this.targetHeight,
      syncStartHeight: this.syncStartHeight,
      progressPercentage: this.getProgressPercentage(),
      currentBatch: this.currentBatch ? { ...this.currentBatch } : null,
      totalBlocksSynced: this.totalBlocksSynced,
      trustedPeerHeights: peerHeightsObj,
      verificationStatus: this.verificationStatus,
      stateRootStatus: this.stateRootStatus,
      receiptRootStatus: this.receiptRootStatus,
      journalReplayStatus: this.journalReplayStatus,
      retriesCount: this.retriesCount,
      recoveryReason: this.recoveryReason,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastFailedSyncAt: this.lastFailedSyncAt,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = {
  SyncStatus,
  LedgerSyncState
};

