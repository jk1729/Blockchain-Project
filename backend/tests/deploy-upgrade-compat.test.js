const { getBuildInfo, BUILD_METADATA } = require('../src/config/buildInfo');
const { VersionNegotiator } = require('../src/utils/versionNegotiator');
const LedgerCheckpoint = require('../src/blockchain/sync/LedgerCheckpoint');

describe('PHASE 11: Upgrade, Versioning & Protocol Compatibility Suite', () => {
  describe('1. Verifiable Build & Version Metadata', () => {
    it('1.1 should expose canonical build metadata without secrets', () => {
      const info = getBuildInfo();
      expect(info.application).toBe('PDSChain Validator Runtime');
      expect(info.version).toBeDefined();
      expect(info.commitHash).toBeDefined();
      expect(info.protocolVersion).toBe(1);
      expect(info.chainId).toBe(1729);
      expect(info.networkId).toBe('pdschain-mainnet');
      expect(info.runtime.node).toMatch(/^v\d+/);
      expect(info.privateKey).toBeUndefined();
    });

    it('1.2 should support metadata overrides for custom environments', () => {
      const custom = getBuildInfo({ protocolVersion: 2, chainId: 999, networkId: 'custom-chain' });
      expect(custom.protocolVersion).toBe(2);
      expect(custom.chainId).toBe(999);
      expect(custom.networkId).toBe('custom-chain');
    });
  });

  describe('2. Protocol Version Negotiation & Mixed-Version Topology', () => {
    it('2.1 should negotiate downward when a peer supports a newer protocol version', () => {
      // Local node is at protocol v1, peer connects with protocol v2
      const result = VersionNegotiator.isCompatible(2, 1);
      expect(result.compatible).toBe(true);
      expect(result.negotiatedVersion).toBe(1); // Downward negotiation preserves consensus safety
    });

    it('2.2 should reject peers running future unsupported protocol versions', () => {
      // Peer runs protocol v99
      const result = VersionNegotiator.isCompatible(99, 1);
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain('ahead of local node');
    });

    it('2.3 should reject peers running obsolete protocol versions', () => {
      const result = VersionNegotiator.isCompatible(0, 1);
      expect(result.compatible).toBe(false);
      expect(result.reason).toContain('obsolete');
    });
  });

  describe('3. Checkpoint & Storage Format Backward Compatibility', () => {
    it('3.1 should validate compatibility of legacy checkpoint records', () => {
      const legacyCheckpoint = {
        height: 10,
        blockHash: '0xabc',
        stateRoot: '0xdef'
      };
      expect(VersionNegotiator.isFormatCompatible(legacyCheckpoint)).toBe(true);
    });

    it('3.2 should validate versioned checkpoint records', () => {
      const versionedCheckpoint = {
        version: 1,
        height: 20,
        blockHash: '0x123'
      };
      expect(VersionNegotiator.isFormatCompatible(versionedCheckpoint)).toBe(true);
    });

    it('3.3 should reject checkpoint records with unsupported future format versions', () => {
      const futureCheckpoint = {
        version: 99,
        height: 20,
        blockHash: '0x123'
      };
      expect(VersionNegotiator.isFormatCompatible(futureCheckpoint)).toBe(false);
    });
  });
});

