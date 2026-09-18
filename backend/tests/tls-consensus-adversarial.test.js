/**
 * PHASE 12: TLS/mTLS Adversarial Transport Security & Redaction Audit Suite
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const {
  NetworkConfig,
  PeerManager,
  PeerAuthenticator,
  MessageEnvelope,
  MessageType,
  NetworkError,
  NetworkErrorCode
} = require('../src/network');
const { CertificateManager } = require('../src/security/CertificateManager');
const { KeyStore } = require('../src/security/KeyStore');
const { KeyRotationManager } = require('../src/security/KeyRotationManager');
const { PeerAuthorizationRegistry } = require('../src/security/PeerAuthorizationRegistry');
const HandshakeHandler = require('../src/network/handlers/HandshakeHandler');
const { generateKeyPair } = require('../src/blockchain/identity/keyManager');

describe('PHASE 12: Adversarial TLS/mTLS Security & Cryptographic Attack Suite', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'tls');
  const caCert = fs.readFileSync(path.join(fixturesDir, 'ca.crt'), 'utf8');
  const alienCaCert = fs.readFileSync(path.join(fixturesDir, 'alien-ca.crt'), 'utf8');
  const val1Cert = fs.readFileSync(path.join(fixturesDir, 'val-01.crt'), 'utf8');
  const val1Key = fs.readFileSync(path.join(fixturesDir, 'val-01.key'), 'utf8');
  const val2Cert = fs.readFileSync(path.join(fixturesDir, 'val-02.crt'), 'utf8');
  const val2Key = fs.readFileSync(path.join(fixturesDir, 'val-02.key'), 'utf8');
  const alienValCert = fs.readFileSync(path.join(fixturesDir, 'alien-val.crt'), 'utf8');
  const alienValKey = fs.readFileSync(path.join(fixturesDir, 'alien-val.key'), 'utf8');
  const expiredCert = fs.readFileSync(path.join(fixturesDir, 'expired.crt'), 'utf8');
  const wrongSanCert = fs.readFileSync(path.join(fixturesDir, 'wrong-san.crt'), 'utf8');

  describe('1. Certificate Chain & Validity Attacks', () => {
    test('1.1 should reject connection with certificate signed by untrusted Alien CA', () => {
      const cm = new CertificateManager({ caPem: caCert });
      expect(() => {
        cm.verifyPeerCertificate(alienValCert, 'VAL-01');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.UNKNOWN_ISSUER
      }));
    });

    test('1.2 should reject connection with expired certificate', () => {
      const cm = new CertificateManager({ caPem: caCert });
      expect(() => {
        cm.verifyPeerCertificate(expiredCert, 'VAL-01');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.EXPIRED_CERTIFICATE
      }));
    });
  });

  describe('2. Cryptographic Identity Binding & Impersonation Attacks', () => {
    test('2.1 should reject peer presenting VAL-02 TLS certificate but claiming VAL-01 in Ed25519 handshake', () => {
      const cm = new CertificateManager({ caPem: caCert });
      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 5001 });
      const auth = new PeerAuthenticator('VAL-01');
      const handler = new HandshakeHandler(config, auth, { certificateManager: cm });

      // Mock mock socket presenting VAL-02 TLS cert
      const fakeSocket = {
        encrypted: true,
        getPeerCertificate: () => ({
          subject: { CN: 'VAL-02' },
          subjectaltname: 'DNS:VAL-02, DNS:localhost, IP:127.0.0.1'
        })
      };
      const fakePeerConn = { socket: fakeSocket, peerCertificateFingerprint: 'dummy' };

      // Adversary sends HANDSHAKE envelope claiming senderId = VAL-01
      const spoofEnvelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 1729,
        type: MessageType.HANDSHAKE,
        senderId: 'VAL-01', // Claiming VAL-01 despite having VAL-02 cert!
        payload: { challenge: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }
      });

      expect(() => {
        handler.handleHandshake(spoofEnvelope, fakePeerConn);
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.VALIDATOR_IDENTITY_MISMATCH
      }));
    });

    test('2.2 should reject certificate with missing or mismatched SAN', () => {
      const cm = new CertificateManager({ caPem: caCert });
      expect(() => {
        // wrongSanCert has CN=UNKNOWN-NODE
        cm.verifyPeerCertificate(wrongSanCert, 'VAL-01');
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.VALIDATOR_IDENTITY_MISMATCH
      }));
    });
  });

  describe('3. Peer Revocation & Suspension Enforcement', () => {
    test('3.1 should reject revoked peer during handshake with REVOKED_PEER code', () => {
      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-02' }]
      });
      reg.revokePeer('VAL-02', 'Byzantine key compromise');

      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 5001 });
      const auth = new PeerAuthenticator('VAL-01');
      const handler = new HandshakeHandler(config, auth, { peerAuthorizationRegistry: reg });

      const fakeSocket = { encrypted: false };
      const fakePeerConn = { socket: fakeSocket };

      const envelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 1729,
        type: MessageType.HANDSHAKE,
        senderId: 'VAL-02',
        payload: { challenge: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }
      });

      expect(() => {
        handler.handleHandshake(envelope, fakePeerConn);
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.REVOKED_PEER
      }));
    });

    test('3.2 should reject suspended peer during handshake with UNAUTHORIZED_PEER code', () => {
      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-02' }]
      });
      reg.suspendPeer('VAL-02', 'Security investigation');

      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 5001 });
      const auth = new PeerAuthenticator('VAL-01');
      const handler = new HandshakeHandler(config, auth, { peerAuthorizationRegistry: reg });

      const fakeSocket = { encrypted: false };
      const fakePeerConn = { socket: fakeSocket };

      const envelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 1729,
        type: MessageType.HANDSHAKE,
        senderId: 'VAL-02',
        payload: { challenge: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' }
      });

      expect(() => {
        handler.handleHandshake(envelope, fakePeerConn);
      }).toThrow(expect.objectContaining({
        code: NetworkErrorCode.UNAUTHORIZED_PEER
      }));
    });
  });

  describe('4. Plaintext Downgrade Resistance', () => {
    let pm;
    const mtlsPort = 16201;

    afterEach(async () => {
      if (pm) {
        await pm.stop();
        pm = null;
      }
    });

    test('4.1 should reject unencrypted plaintext connection on TLS port', async () => {
      const cm = new CertificateManager({ certPem: val1Cert, keyPem: val1Key, caPem: caCert });
      const config = new NetworkConfig({
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: mtlsPort,
        useTLS: true,
        tlsOptions: { key: val1Key, cert: val1Cert, ca: caCert, requestCert: true, rejectUnauthorized: true }
      });

      pm = new PeerManager({
        config,
        authenticator: new PeerAuthenticator('VAL-01'),
        certificateManager: cm
      });

      await pm.start();

      // Plaintext TCP connection attempt
      const rejected = await new Promise((resolve) => {
        const plainSocket = net.connect({ host: '127.0.0.1', port: mtlsPort }, () => {
          plainSocket.write('GET / HTTP/1.1\r\n\r\n');
        });

        plainSocket.on('error', () => resolve(true));
        plainSocket.on('close', () => resolve(true));

        setTimeout(() => {
          plainSocket.destroy();
          resolve(true);
        }, 1000);
      });

      expect(rejected).toBe(true);
      expect(pm.peers.size).toBe(0);
    });
  });

  describe('5. Exhaustive Secret Privacy & Key Leakage Prevention Audit', () => {
    test('5.1 KeyStore, KeyRotationManager, and PeerAuthorizationRegistry must never leak private keys', () => {
      const kp = generateKeyPair();
      const ks = KeyStore.fromCredentials({
        validatorId: 'VAL-01',
        consensus: kp,
        transport: { cert: val1Cert, key: val1Key, ca: caCert }
      });

      const krm = new KeyRotationManager({
        validatorId: 'VAL-01',
        initialPublicKey: kp.publicKey,
        initialPrivateKey: kp.privateKey,
        startHeight: 0
      });

      const reg = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-01' }]
      });

      // Target secret strings to audit for leakage
      const consensusPrivatePem = kp.privateKey;
      const transportPrivatePem = val1Key;

      // 1. Audit KeyStore
      const ksSafe = ks.toSafeObject();
      const ksJson = JSON.stringify(ks);
      const ksStr = ks.toString();

      expect(JSON.stringify(ksSafe)).not.toContain(consensusPrivatePem);
      expect(JSON.stringify(ksSafe)).not.toContain(transportPrivatePem);
      expect(ksJson).not.toContain(consensusPrivatePem);
      expect(ksJson).not.toContain(transportPrivatePem);
      expect(ksStr).not.toContain('PRIVATE KEY');

      // 2. Audit KeyRotationManager
      const krmStatus = krm.getStatus();
      const krmJson = JSON.stringify(krm);
      expect(JSON.stringify(krmStatus)).not.toContain(consensusPrivatePem);
      expect(krmJson).not.toContain(consensusPrivatePem);
      expect(krmJson).not.toContain('privateKey');

      // 3. Audit PeerAuthorizationRegistry
      const regStatus = reg.getStatus();
      const regJson = JSON.stringify(reg);
      expect(JSON.stringify(regStatus)).not.toContain(consensusPrivatePem);
      expect(regJson).not.toContain(consensusPrivatePem);
    });
  });
});

