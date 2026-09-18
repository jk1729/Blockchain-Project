/**
 * PDSChain High Availability & Failover Coordinator (Phase 18)
 * 
 * Enforces writer fencing, split-brain prevention, and replica freshness checks
 * across multi-node consortium deployments.
 */

class HAError extends Error {
  constructor(message, code = 'HA_ERROR', details = {}) {
    super(message);
    this.name = 'HAError';
    this.code = code;
    this.details = details;
  }
}

class DatabaseHAManager {
  /**
   * @param {object} [options]
   * @param {string} [options.nodeId='NODE-01']
   * @param {string} [options.role='PRIMARY'] - 'PRIMARY' or 'REPLICA'
   * @param {number} [options.maxAllowedLag=5] - Maximum acceptable block lag for read replica
   */
  constructor(options = {}) {
    this.nodeId = options.nodeId || 'NODE-01';
    this.role = options.role || 'PRIMARY';
    this.maxAllowedLag = options.maxAllowedLag || 5;

    // Monotonically increasing fencing token
    this.currentFencingToken = 1;
    this.activeWriterId = this.nodeId;
    this.isFenced = false;
  }

  /**
   * Acquire leadership and increment fencing token
   * @param {string} writerId 
   * @returns {number} New fencing token
   */
  promoteToPrimary(writerId) {
    this.currentFencingToken++;
    this.activeWriterId = writerId;
    this.role = 'PRIMARY';
    this.isFenced = false;
    return this.currentFencingToken;
  }

  /**
   * Fence the current node from making authoritative consensus writes
   */
  fenceNode() {
    this.isFenced = true;
    this.role = 'REPLICA';
  }

  /**
   * Validate that a candidate write possesses the authoritative fencing token
   * @param {number} token 
   * @param {string} writerId 
   */
  assertWriterAuthorization(token, writerId) {
    if (this.isFenced) {
      throw new HAError('Node is fenced from performing writes', 'NODE_FENCED');
    }

    if (this.role !== 'PRIMARY') {
      throw new HAError('Only PRIMARY role is permitted to perform authoritative writes', 'READ_ONLY_REPLICA');
    }

    if (token < this.currentFencingToken) {
      throw new HAError(
        `Fencing token stale: token ${token} < current ${this.currentFencingToken}. Writer superseded.`,
        'FENCING_TOKEN_STALE',
        { provided: token, current: this.currentFencingToken }
      );
    }

    if (writerId !== this.activeWriterId) {
      throw new HAError(
        `Writer ID '${writerId}' does not match active primary '${this.activeWriterId}'`,
        'SPLIT_BRAIN_GUARD',
        { providedWriter: writerId, activeWriter: this.activeWriterId }
      );
    }

    return true;
  }

  /**
   * Evaluate replica freshness and lag
   * @param {number} primaryHeight 
   * @param {number} replicaHeight 
   * @returns {{ isFresh: boolean, lag: number, status: string }}
   */
  evaluateReplicaFreshness(primaryHeight, replicaHeight) {
    const lag = Math.max(0, primaryHeight - replicaHeight);
    const isFresh = lag <= this.maxAllowedLag;

    return {
      isFresh,
      lag,
      status: isFresh ? 'HEALTHY' : 'STALE_REPLICA',
      primaryHeight,
      replicaHeight
    };
  }
}

module.exports = {
  DatabaseHAManager,
  HAError
};

