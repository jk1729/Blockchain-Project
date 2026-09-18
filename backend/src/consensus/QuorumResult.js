/**
 * QuorumResult Class
 * Structured evaluation result for FBA quorum calculations.
 */

class QuorumResult {
  constructor(data = {}) {
    this.isQuorum = Boolean(data.isQuorum);
    this.hasGlobalThreshold = Boolean(data.hasGlobalThreshold);
    this.isSatisfied = Boolean(data.isSatisfied !== undefined ? data.isSatisfied : (this.isQuorum && this.hasGlobalThreshold));
    this.quorumMembers = Array.isArray(data.quorumMembers) ? [...data.quorumMembers].sort() : [];
    this.quorumSize = parseInt(data.quorumSize !== undefined ? data.quorumSize : this.quorumMembers.length, 10);
    this.threshold = parseInt(data.threshold, 10) || 9;
    this.totalValidators = parseInt(data.totalValidators, 10) || 12;
    this.supportingValidators = Array.isArray(data.supportingValidators) ? [...data.supportingValidators].sort() : [];
    this.missingValidators = Array.isArray(data.missingValidators) ? [...data.missingValidators].sort() : [];
    this.sliceEvaluations = data.sliceEvaluations || {};
    this.conflictDetected = Boolean(data.conflictDetected);
    this.conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
    this.failureReasons = Array.isArray(data.failureReasons) ? data.failureReasons : [];
  }

  toJSON() {
    return {
      isQuorum: this.isQuorum,
      hasGlobalThreshold: this.hasGlobalThreshold,
      isSatisfied: this.isSatisfied,
      quorumMembers: this.quorumMembers,
      quorumSize: this.quorumSize,
      threshold: this.threshold,
      totalValidators: this.totalValidators,
      supportingValidators: this.supportingValidators,
      missingValidators: this.missingValidators,
      sliceEvaluations: this.sliceEvaluations,
      conflictDetected: this.conflictDetected,
      conflicts: this.conflicts,
      failureReasons: this.failureReasons
    };
  }
}

module.exports = QuorumResult;

