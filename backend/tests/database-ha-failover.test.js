/**
 * Phase 18: Database High Availability & Failover Test Suite
 */

const { DatabaseHAManager, HAError } = require('../src/database/DatabaseHAManager');

describe('Phase 18: Database HA, Writer Fencing & Split-Brain Prevention', () => {
  let haManager;

  beforeEach(() => {
    haManager = new DatabaseHAManager({
      nodeId: 'VAL-01',
      role: 'PRIMARY',
      maxAllowedLag: 5
    });
  });

  describe('1. Writer Fencing & Split-Brain Prevention', () => {
    test('primary node with current fencing token should be authorized to write', () => {
      const authorized = haManager.assertWriterAuthorization(1, 'VAL-01');
      expect(authorized).toBe(true);
    });

    test('should reject write from writer presenting stale fencing token', () => {
      // Simulate primary promotion that increments fencing token to 2
      haManager.promoteToPrimary('VAL-02');

      // Attempt write with old token 1
      expect(() => {
        haManager.assertWriterAuthorization(1, 'VAL-01');
      }).toThrow('Fencing token stale');
    });

    test('should reject writes when node is fenced', () => {
      haManager.fenceNode();

      expect(() => {
        haManager.assertWriterAuthorization(haManager.currentFencingToken, 'VAL-01');
      }).toThrow('Node is fenced from performing writes');
    });

    test('should reject writes if node is in REPLICA role', () => {
      haManager.role = 'REPLICA';

      expect(() => {
        haManager.assertWriterAuthorization(haManager.currentFencingToken, 'VAL-01');
      }).toThrow('Only PRIMARY role is permitted to perform authoritative writes');
    });

    test('should detect split-brain if candidate writer ID does not match active primary', () => {
      expect(() => {
        haManager.assertWriterAuthorization(1, 'VAL-02-COMPETING');
      }).toThrow('does not match active primary');
    });
  });

  describe('2. Replica Lag & Freshness Tracking', () => {
    test('replica within acceptable lag boundary should be classified HEALTHY', () => {
      const evaluation = haManager.evaluateReplicaFreshness(100, 98);
      expect(evaluation.isFresh).toBe(true);
      expect(evaluation.lag).toBe(2);
      expect(evaluation.status).toBe('HEALTHY');
    });

    test('replica exceeding maximum lag should be classified STALE_REPLICA', () => {
      const evaluation = haManager.evaluateReplicaFreshness(100, 90);
      expect(evaluation.isFresh).toBe(false);
      expect(evaluation.lag).toBe(10);
      expect(evaluation.status).toBe('STALE_REPLICA');
    });
  });
});

