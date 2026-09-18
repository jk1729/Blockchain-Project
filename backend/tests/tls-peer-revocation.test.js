/**
 * PHASE 12: Peer Authorization, Revocation (CRL) & Suspension Test Suite
 */

const { PeerAuthorizationRegistry, PeerStatus } = require('../src/security/PeerAuthorizationRegistry');
const { NetworkError, NetworkErrorCode } = require('../src/network/NetworkErrors');

describe('PHASE 12: Peer Authorization, CRL & Revocation Management', () => {
  describe('1. Peer Whitelisting & Strict Mode Enforcement', () => {
    test('1.1 should authorize whitelisted consortium validator', () => {
      const reg = new PeerAuthorizationRegistry({
        strictMode: true,
        initialPeers: [{ validatorId: 'VAL-01' }, { validatorId: 'VAL-02' }]
      });

      const check1 = reg.checkAuthorization('VAL-01');
      expect(check1.authorized).toBe(true);

      const check2 = reg.checkAuthorization('VAL-02');
      expect(check2.authorized).toBe(true);
    });

    test('1.2 should reject unlisted peer in strictMode with UNAUTHORIZED_PEER', () => {
      const reg = new PeerAuthorizationRegistry({
        strictMode: true,
        initialPeers: [{ validatorId: 'VAL-01' }]
      });

      const check = reg.checkAuthorization('VAL-99');
      expect(check.authorized).toBe(false);
      expect(check.code).toBe(NetworkErrorCode.UNAUTHORIZED_PEER);

      expect(() => {
        reg.assertAuthorized('VAL-99');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.UNAUTHORIZED_PEER
      }));
    });
  });

  describe('2. Peer Revocation & Permanent Exclusion', () => {
    test('2.1 should permanently reject revoked peer with REVOKED_PEER code', () => {
      const reg = new PeerAuthorizationRegistry({
        strictMode: true,
        initialPeers: [{ validatorId: 'VAL-01' }, { validatorId: 'VAL-02' }]
      });

      reg.revokePeer('VAL-02', 'Byzantine double-signing detected');

      const check = reg.checkAuthorization('VAL-02');
      expect(check.authorized).toBe(false);
      expect(check.code).toBe(NetworkErrorCode.REVOKED_PEER);
      expect(check.reason).toContain('Byzantine double-signing');

      expect(() => {
        reg.assertAuthorized('VAL-02');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.REVOKED_PEER
      }));
    });

    test('2.2 should emit peer_revoked event on revocation', (done) => {
      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-01' }]
      });

      reg.on('peer_revoked', (evt) => {
        expect(evt.validatorId).toBe('VAL-01');
        expect(evt.reason).toBe('Compromised private key');
        done();
      });

      reg.revokePeer('VAL-01', 'Compromised private key');
    });
  });

  describe('3. Peer Suspension & Re-Activation', () => {
    test('3.1 should reject suspended peer, then permit when unsuspended', () => {
      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-03' }]
      });

      reg.suspendPeer('VAL-03', 'Scheduled hardware maintenance');

      const checkSuspended = reg.checkAuthorization('VAL-03');
      expect(checkSuspended.authorized).toBe(false);
      expect(checkSuspended.code).toBe(NetworkErrorCode.UNAUTHORIZED_PEER);
      expect(checkSuspended.reason).toContain('Scheduled hardware maintenance');

      // Unsuspend
      reg.unsuspendPeer('VAL-03');
      const checkUnsuspended = reg.checkAuthorization('VAL-03');
      expect(checkUnsuspended.authorized).toBe(true);
    });
  });

  describe('4. Certificate Fingerprint Revocation (CRL)', () => {
    test('4.1 should reject connection when certificate fingerprint is on CRL', () => {
      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-01' }]
      });

      const badFingerprint = 'A1:B2:C3:D4:E5:F6:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:01:02:03:04:05:06:07:08:09:0A';
      reg.revokeCertificate(badFingerprint, 'Compromised TLS transport key');

      const check = reg.checkAuthorization('VAL-01', badFingerprint);
      expect(check.authorized).toBe(false);
      expect(check.code).toBe(NetworkErrorCode.REVOKED_CERTIFICATE);
    });

    test('4.2 should enforce pinned certificate fingerprint matching when configured', () => {
      const reg = new PeerAuthorizationRegistry();
      const expectedFingerprint = '11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';
      const actualFingerprint = '99:99:99:99:99:99:99:99:99:99:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';

      reg.addPeer('VAL-04', { fingerprint: expectedFingerprint });

      const check = reg.checkAuthorization('VAL-04', actualFingerprint);
      expect(check.authorized).toBe(false);
      expect(check.code).toBe(NetworkErrorCode.CERTIFICATE_MISMATCH);
    });
  });
});

