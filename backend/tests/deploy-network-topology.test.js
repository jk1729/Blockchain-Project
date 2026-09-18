const { ValidatorConfig, ConfigurationError } = require('../src/config/validatorConfig');
const { NetworkConfig, PeerAuthenticator, MessageEnvelope, MessageType, NetworkErrorCode } = require('../src/network');
const { VersionNegotiator } = require('../src/utils/versionNegotiator');

describe('PHASE 11: Networking & Production Topology Deployment Suite', () => {
  describe('1. Bind vs. Advertised Topology', () => {
    it('1.1 should configure distinct bind and advertised addresses for NAT / Cloud deployment', () => {
      const config = new ValidatorConfig({
        validatorId: 'VAL-01',
        listenHost: '0.0.0.0',
        listenPort: 5001,
        advertisedHost: '198.51.100.1',
        advertisedPort: 5001,
        apiHost: '0.0.0.0',
        apiPort: 4001,
        networkId: 'pdschain-mainnet'
      });

      expect(config.listenHost).toBe('0.0.0.0');
      expect(config.advertisedHost).toBe('198.51.100.1');
      expect(config.validate()).toBe(true);

      const safe = config.toSafeObject();
      expect(safe.listenHost).toBe('0.0.0.0');
      expect(safe.advertisedHost).toBe('198.51.100.1');
    });

    it('1.2 should fallback advertised host to listen host when not explicitly specified', () => {
      const config = new ValidatorConfig({
        validatorId: 'VAL-02',
        listenHost: '10.0.0.5',
        listenPort: 5002,
        apiPort: 4002
      });

      expect(config.advertisedHost).toBe('10.0.0.5');
      expect(config.advertisedPort).toBe(5002);
    });
  });

  describe('2. Unauthorized Peer & Network Isolation', () => {
    it('2.1 should reject unauthorized validator trying to authenticate', () => {
      const auth = new PeerAuthenticator('VAL-01', ['VAL-01', 'VAL-02', 'VAL-03']);
      const nonce = auth.createChallenge();

      expect(() => {
        auth.verifyChallenge('ATTACKER-VAL-99', nonce, '0x1234');
      }).toThrow(/not authorized to join/);
    });

    it('2.2 should reject message envelope with wrong networkId', () => {
      const envelope = new MessageEnvelope({
        version: 1,
        networkId: 'wrong-alien-network',
        chainId: 1729,
        type: MessageType.HEARTBEAT,
        senderId: 'VAL-02'
      });

      const netConfig = NetworkConfig.forValidator('VAL-01', { networkId: 'pdschain-mainnet' });
      expect(() => envelope.validate(netConfig)).toThrow(/Network ID mismatch/);
    });

    it('2.3 should reject message envelope with wrong chainId', () => {
      const envelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 99999,
        type: MessageType.HEARTBEAT,
        senderId: 'VAL-02'
      });

      const netConfig = NetworkConfig.forValidator('VAL-01', { networkId: 'pdschain-mainnet', chainId: 1729 });
      expect(() => envelope.validate(netConfig)).toThrow(/Chain ID mismatch/);
    });
  });

  describe('3. Protocol Version Negotiation', () => {
    it('3.1 should accept matching or compatible protocol version', () => {
      const res = VersionNegotiator.isCompatible(1, 1);
      expect(res.compatible).toBe(true);
      expect(res.negotiatedVersion).toBe(1);
    });

    it('3.2 should negotiate lower common protocol version within supported bounds', () => {
      const res = VersionNegotiator.isCompatible(2, 1);
      expect(res.compatible).toBe(true);
      expect(res.negotiatedVersion).toBe(1);
    });

    it('3.3 should reject obsolete or incompatible protocol versions', () => {
      const res1 = VersionNegotiator.isCompatible(0, 1);
      expect(res1.compatible).toBe(false);

      const res2 = VersionNegotiator.isCompatible(99, 1);
      expect(res2.compatible).toBe(false);
    });
  });
});
