/**
 * PDSChain Simulation Invariant Monitor (Phase 20 - Stage C)
 * 
 * Asserts mandatory safety, ledger, consensus, database, security, and observability
 * invariants during and after simulation runs.
 */

class InvariantViolationError extends Error {
  constructor(invariantName, message, details = {}) {
    super(`[INVARIANT VIOLATION: ${invariantName}] ${message}`);
    this.name = 'InvariantViolationError';
    this.invariantName = invariantName;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class InvariantMonitor {
  /**
   * Assert that block height has not regressed.
   */
  static assertMonotonicHeight(baselineHeight, postHeight) {
    const base = Number(baselineHeight) || 0;
    const post = Number(postHeight) || 0;

    if (post < base) {
      throw new InvariantViolationError(
        'LEDGER_MONOTONIC_HEIGHT',
        `Post-simulation height (${post}) is lower than baseline height (${base})`,
        { baselineHeight: base, postHeight: post }
      );
    }
    return { name: 'LEDGER_MONOTONIC_HEIGHT', passed: true, details: { baselineHeight: base, postHeight: post } };
  }

  /**
   * Assert that a finalized block hash has not changed.
   */
  static assertImmutableBlockHash(expectedHash, actualHash, blockHeight = null) {
    if (!expectedHash || !actualHash || expectedHash !== actualHash) {
      throw new InvariantViolationError(
        'LEDGER_IMMUTABLE_BLOCK_HASH',
        `Finalized block hash mutated! Expected "${expectedHash}", found "${actualHash}"`,
        { expectedHash, actualHash, blockHeight }
      );
    }
    return { name: 'LEDGER_IMMUTABLE_BLOCK_HASH', passed: true, details: { expectedHash, actualHash } };
  }

  /**
   * Assert that block heights form a strictly contiguous sequence without gaps.
   */
  static assertSequenceContinuity(blocks = []) {
    if (!Array.isArray(blocks) || blocks.length <= 1) {
      return { name: 'LEDGER_SEQUENCE_CONTINUITY', passed: true, details: { count: blocks ? blocks.length : 0 } };
    }

    for (let i = 1; i < blocks.length; i++) {
      const prevHeight = Number(blocks[i - 1].height !== undefined ? blocks[i - 1].height : blocks[i - 1].number);
      const currHeight = Number(blocks[i].height !== undefined ? blocks[i].height : blocks[i].number);

      if (currHeight !== prevHeight + 1) {
        throw new InvariantViolationError(
          'LEDGER_SEQUENCE_CONTINUITY',
          `Block sequence gap detected between block ${prevHeight} and block ${currHeight}`,
          { prevHeight, currHeight, index: i }
        );
      }
    }

    return { name: 'LEDGER_SEQUENCE_CONTINUITY', passed: true, details: { totalBlocks: blocks.length } };
  }

  /**
   * Assert that every block correctly references the previous block's hash.
   */
  static assertParentHashContinuity(blocks = []) {
    if (!Array.isArray(blocks) || blocks.length <= 1) {
      return { name: 'LEDGER_PARENT_HASH_CONTINUITY', passed: true, details: { count: blocks ? blocks.length : 0 } };
    }

    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      const curr = blocks[i];
      const prevHash = prev.hash || prev.blockHash;
      const currParentHash = curr.previousHash || curr.parentHash;

      if (!prevHash || !currParentHash || prevHash !== currParentHash) {
        throw new InvariantViolationError(
          'LEDGER_PARENT_HASH_CONTINUITY',
          `Parent hash discontinuity at block index ${i}! Expected previousHash "${prevHash}", got "${currParentHash}"`,
          { index: i, prevHash, currParentHash }
        );
      }
    }

    return { name: 'LEDGER_PARENT_HASH_CONTINUITY', passed: true, details: { verifiedBlocks: blocks.length } };
  }

  /**
   * Assert that writer fencing tokens are strictly increasing.
   */
  static assertWriterFencingToken(currentToken, candidateToken) {
    const cur = Number(currentToken) || 0;
    const cand = Number(candidateToken) || 0;

    if (cand <= cur) {
      throw new InvariantViolationError(
        'DATABASE_WRITER_FENCING',
        `Candidate writer fencing token (${cand}) is not strictly greater than current token (${cur})`,
        { currentToken: cur, candidateToken: cand }
      );
    }
    return { name: 'DATABASE_WRITER_FENCING', passed: true, details: { currentToken: cur, candidateToken: cand } };
  }

  /**
   * Assert that a failed or aborted transaction leaves row count completely unchanged.
   */
  static assertAtomicRollback(preCount, postCount) {
    if (preCount !== postCount) {
      throw new InvariantViolationError(
        'DATABASE_ATOMIC_ROLLBACK',
        `Transaction rollback failed atomicity! Pre-transaction count was ${preCount}, but post-rollback count is ${postCount}`,
        { preCount, postCount }
      );
    }
    return { name: 'DATABASE_ATOMIC_ROLLBACK', passed: true, details: { preCount, postCount } };
  }

  /**
   * Assert that an unauthorized or unauthenticated request received default-deny rejection.
   */
  static assertDefaultDeny(responseOrStatusCode) {
    const status = typeof responseOrStatusCode === 'object' && responseOrStatusCode !== null
      ? (responseOrStatusCode.status || responseOrStatusCode.statusCode)
      : Number(responseOrStatusCode);

    if (status !== 401 && status !== 403) {
      throw new InvariantViolationError(
        'SECURITY_DEFAULT_DENY',
        `Request bypassed default-deny authorization! Expected HTTP 401 or 403, received ${status}`,
        { status }
      );
    }
    return { name: 'SECURITY_DEFAULT_DENY', passed: true, details: { status } };
  }

  /**
   * Assert that object or string payload contains zero raw private keys, passwords, or tokens.
   */
  static assertZeroSecretLeakage(payload) {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    if (!serialized) {
      return { name: 'SECURITY_ZERO_SECRET_LEAKAGE', passed: true };
    }

    // Common secret patterns
    const secretRegexes = [
      /(?:private[_-]?key|secret[_-]?key|password|passphrase|token|mnemonic)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{16,})/i,
      /(?:private[_-]?key|secret[_-]?key|privkey|seed)["']?\s*[:=]\s*["']?(?:0x)?[a-fA-F0-9]{64}/i,
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
      /eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/ // JWT token
    ];

    for (const regex of secretRegexes) {
      const match = serialized.match(regex);
      if (match) {
        // Exception: allow test strings explicitly labeled as REDACTED or [REDACTED] or simulated synthetic IDs
        if (match[0].includes('REDACTED') || match[0].includes('sim-') || match[0].includes('0x0000000000000000')) {
          continue;
        }
        throw new InvariantViolationError(
          'SECURITY_ZERO_SECRET_LEAKAGE',
          `Potential secret or sensitive credential detected in simulation payload: "${match[0].substring(0, 20)}..."`,
          { matchedSnippet: match[0].substring(0, 20) + '...' }
        );
      }
    }

    return { name: 'SECURITY_ZERO_SECRET_LEAKAGE', passed: true };
  }

  /**
   * Execute a batch of invariant assertions safely and summarize outcomes.
   */
  static verifyBatch(checks = []) {
    const results = [];
    let allPassed = true;

    for (const check of checks) {
      try {
        const res = typeof check === 'function' ? check() : check;
        results.push(res);
      } catch (err) {
        allPassed = false;
        results.push({
          name: err.invariantName || 'UNKNOWN_INVARIANT',
          passed: false,
          error: err.message,
          details: err.details || {}
        });
      }
    }

    return {
      allPassed,
      results
    };
  }
}

module.exports = {
  InvariantMonitor,
  InvariantViolationError
};
