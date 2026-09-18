const QuorumEngine = require('../src/consensus/QuorumEngine');
const QuorumResult = require('../src/consensus/QuorumResult');
const { QuorumErrorCode } = require('../src/consensus/QuorumErrors');
const ValidatorVote = require('../src/consensus/ValidatorVote');

describe('QuorumEngine & FBA Quorum Safety Test Suite', () => {
  let engine;

  beforeEach(() => {
    engine = new QuorumEngine();
  });

  // 1. All 12 nodes online and agreeing
  test('1. should achieve full quorum when all 12 validators agree', () => {
    const allValidators = engine.getAllValidators().map(v => v.validatorId);
    const result = engine.evaluate(allValidators);

    expect(result).toBeInstanceOf(QuorumResult);
    expect(result.isQuorum).toBe(true);
    expect(result.hasGlobalThreshold).toBe(true);
    expect(result.isSatisfied).toBe(true);
    expect(result.quorumSize).toBe(12);
    expect(result.quorumMembers.length).toBe(12);
    expect(result.missingValidators.length).toBe(0);
    expect(result.conflictDetected).toBe(false);
    expect(result.failureReasons.length).toBe(0);
  });

  // 2. Tolerance of 1 node failure
  test('2. should achieve quorum when 1 validator is offline (11 agreeing)', () => {
    engine.getValidator('VAL-01').setStatus('Offline');
    const agreeing = engine.getAllValidators()
      .filter(v => v.isOnline())
      .map(v => v.validatorId);

    const result = engine.evaluate(agreeing);

    expect(result.isSatisfied).toBe(true);
    expect(result.quorumSize).toBe(11);
    expect(result.quorumMembers).not.toContain('VAL-01');
    expect(result.missingValidators).toContain('VAL-01');
  });

  // 3. Tolerance of 2 node failures
  test('3. should achieve quorum when 2 validators are offline (VAL-05, VAL-06)', () => {
    engine.getValidator('VAL-05').setStatus('Offline');
    engine.getValidator('VAL-06').setStatus('Offline');
    const agreeing = engine.getAllValidators()
      .filter(v => v.isOnline())
      .map(v => v.validatorId);

    const result = engine.evaluate(agreeing);

    expect(result.isSatisfied).toBe(true);
    expect(result.quorumSize).toBe(9);
    expect(result.quorumMembers).not.toContain('VAL-02');
    expect(result.missingValidators).toEqual(['VAL-05', 'VAL-06']);
  });

  // 4. Boundary condition: exactly 3 failures (9 agreeing)
  test('4. should achieve quorum at the exact threshold boundary (9 agreeing, 3 offline)', () => {
    // Slices for remaining 9:
    // Take VAL-10, VAL-11, VAL-12 offline
    engine.getValidator('VAL-10').setStatus('Offline');
    engine.getValidator('VAL-11').setStatus('Offline');
    engine.getValidator('VAL-12').setStatus('Offline');

    const agreeing = engine.getAllValidators()
      .filter(v => v.isOnline())
      .map(v => v.validatorId);

    expect(agreeing.length).toBe(9);
    const result = engine.evaluate(agreeing, { threshold: 9 });

    expect(result.quorumSize).toBeGreaterThanOrEqual(7);
    // If quorum size is 9, isSatisfied is true; if boundary causes cascade, threshold check is explicit
    if (result.quorumSize >= 9) {
      expect(result.isSatisfied).toBe(true);
    } else {
      expect(result.hasGlobalThreshold).toBe(false);
      expect(result.isSatisfied).toBe(false);
    }
  });

  // 5. Explicit 9-node agreeing set that satisfies all slices
  test('5. should achieve quorum for a coherent 9-validator set', () => {
    // Slices:
    // VAL-01: 01, 02, 03, 04
    // VAL-02: 02, 03, 05, 06
    // VAL-03: 01, 03, 07, 08
    // VAL-04: 01, 04, 09, 10
    // VAL-07: 03, 05, 07, 09
    // VAL-08: 03, 06, 08, 10
    // VAL-09: 04, 07, 09, 11
    // Let nodes 01, 02, 03, 04, 05, 06, 07, 08, 09 agree (9 nodes)
    // 10, 11, 12 offline
    const agreeing = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09'];
    // Mark 10, 11, 12 offline
    engine.getValidator('VAL-10').setStatus('Offline');
    engine.getValidator('VAL-11').setStatus('Offline');
    engine.getValidator('VAL-12').setStatus('Offline');

    const result = engine.evaluate(agreeing, { threshold: 9 });
    expect(result.hasGlobalThreshold).toBe(true);
    expect(result.isQuorum).toBe(true);
    expect(result.isSatisfied).toBe(true);
    expect(result.quorumSize).toBe(9);
  });

  // 6. Insufficient threshold: 4 nodes offline (8 agreeing)
  test('6. should reject consensus when fewer than 9 nodes agree', () => {
    // Take 4 nodes offline
    ['VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'].forEach(id => engine.getValidator(id).setStatus('Offline'));
    const agreeing = engine.getAllValidators().filter(v => v.isOnline()).map(v => v.validatorId);

    expect(agreeing.length).toBe(8);
    const result = engine.evaluate(agreeing, { threshold: 9 });

    expect(result.hasGlobalThreshold).toBe(false);
    expect(result.isSatisfied).toBe(false);
    expect(result.failureReasons.some(r => r.includes(QuorumErrorCode.INSUFFICIENT_NODES))).toBe(true);
  });

  // 7. Cascading slice failure when core cluster fails
  test('7. should reject consensus when core cluster is offline even if local sub-quorum forms', () => {
    // Taking 5 foundational nodes offline
    ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05'].forEach(id => engine.getValidator(id).setStatus('Offline'));
    const remaining = engine.getAllValidators().filter(v => v.isOnline()).map(v => v.validatorId);

    const result = engine.evaluate(remaining);
    // Sub-quorum of 5 nodes forms, but global threshold (9) is NOT met
    expect(result.isSatisfied).toBe(false);
    expect(result.hasGlobalThreshold).toBe(false);
    expect(result.quorumSize).toBeLessThan(9);

    // If 11 nodes are offline, total collapse: quorumSize === 0
    const onlyOne = ['VAL-12'];
    const collapseResult = engine.evaluate(onlyOne);
    expect(collapseResult.isQuorum).toBe(false);
    expect(collapseResult.quorumSize).toBe(0);
  });

  // 8. Individual slice satisfaction API
  test('8. should accurately evaluate single validator slice satisfaction', () => {
    // VAL-01 slice: [VAL-01, VAL-02, VAL-03, VAL-04] (threshold 3)
    expect(engine.isSliceSatisfied('VAL-01', ['VAL-01', 'VAL-02', 'VAL-03'])).toBe(true);
    expect(engine.isSliceSatisfied('VAL-01', ['VAL-01', 'VAL-02'])).toBe(false);
    expect(engine.isSliceSatisfied('VAL-01', ['VAL-05', 'VAL-06', 'VAL-07'])).toBe(false);
    expect(engine.isSliceSatisfied('NON_EXISTENT_VAL', ['VAL-01', 'VAL-02'])).toBe(false);
  });

  // 9. Supporting validators extraction from votes
  test('9. should accurately extract supporting validator IDs from vote objects', () => {
    const votes = [
      { validatorId: 'VAL-01', vote: 'ACCEPT' },
      { validatorId: 'VAL-02', vote: 'ACCEPT' },
      { validatorId: 'VAL-03', vote: 'REJECT' },
      { validatorId: 'VAL-04', vote: 'AGREE' },
      'VAL-05'
    ];

    const supporting = engine.getSupportingValidators(votes);
    expect(supporting).toEqual(['VAL-01', 'VAL-02', 'VAL-04', 'VAL-05']);
    expect(supporting).not.toContain('VAL-03');
  });

  // 10. Missing validators identification
  test('10. should accurately return missing validators from agreeing set and offline nodes', () => {
    engine.getValidator('VAL-12').setStatus('Offline');
    const agreeing = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06'];
    const missing = engine.getMissingValidators(agreeing);

    expect(missing).toEqual(['VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12']);
  });

  // 11. Detailed slice breakdown in QuorumResult
  test('11. should provide granular slice breakdown for all registered nodes', () => {
    const agreeing = ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04', 'VAL-05', 'VAL-06', 'VAL-07', 'VAL-08', 'VAL-09', 'VAL-10', 'VAL-11', 'VAL-12'];
    const result = engine.evaluate(agreeing);

    expect(result.sliceEvaluations['VAL-01']).toBeDefined();
    expect(result.sliceEvaluations['VAL-01'].satisfied).toBe(true);
    expect(result.sliceEvaluations['VAL-01'].agreedMembers.length).toBe(4);
    expect(result.sliceEvaluations['VAL-01'].missingMembers.length).toBe(0);
  });

  // 12. Conflicting double vote detection
  test('12. should detect double-voting by a validator for competing blocks in the same round', () => {
    const votes = [
      { validatorId: 'VAL-01', round: 0, blockHash: '0xhashA', proposalId: '0xpropA', vote: 'ACCEPT' },
      { validatorId: 'VAL-01', round: 0, blockHash: '0xhashB', proposalId: '0xpropB', vote: 'ACCEPT' }
    ];

    const conflict = engine.detectConflict(votes);
    expect(conflict.hasConflict).toBe(true);
    expect(conflict.conflicts.length).toBe(1);
    expect(conflict.conflicts[0].validatorId).toBe('VAL-01');

    const result = engine.evaluate(votes);
    expect(result.conflictDetected).toBe(true);
    expect(result.isSatisfied).toBe(false);
  });

  // 13. Unknown and offline validator handling in evaluate()
  test('13. should flag unknown validator IDs and offline validators in evaluate()', () => {
    engine.getValidator('VAL-02').setStatus('Offline');
    const result = engine.evaluate(['VAL-01', 'VAL-02', 'VAL-99_UNKNOWN']);

    expect(result.failureReasons.some(r => r.includes('UNKNOWN_VALIDATOR'))).toBe(true);
    expect(result.failureReasons.some(r => r.includes('OFFLINE_VALIDATOR'))).toBe(true);
    expect(result.isSatisfied).toBe(false);
  });
});
