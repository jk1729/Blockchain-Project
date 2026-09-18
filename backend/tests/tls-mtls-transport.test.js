/**
 * PHASE 12: Mutual TLS (mTLS) Transport & Multi-Process Health Integration Test Suite
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const {
  NetworkConfig,
  PeerManager,
  PeerAuthenticator,
  MessageEnvelope,
  MessageType
} = require('../src/network');
const { CertificateManager } = require('../src/security/CertificateManager');
const { PeerAuthorizationRegistry } = require('../src/security/PeerAuthorizationRegistry');
const ValidatorProcess = require('../src/validators/validatorProcess');

describe('PHASE 12: Mutual TLS (mTLS) Authenticated Peer Transport Suite', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'tls');
  const caCert = fs.readFileSync(path.join(fixturesDir, 'ca.crt'), 'utf8');
  const val1Cert = fs.readFileSync(path.join(fixturesDir, 'val-01.crt'), 'utf8');
  const val1Key = fs.readFileSync(path.join(fixturesDir, 'val-01.key'), 'utf8');
  const val2Cert = fs.readFileSync(path.join(fixturesDir, 'val-02.crt'), 'utf8');
  const val2Key = fs.readFileSync(path.join(fixturesDir, 'val-02.key'), 'utf8');

  let pm1;
  let pm2;
  const port1 = 16101;
  const port2 = 16102;

  afterEach(async () => {
    if (pm1) {
      await pm1.stop();
      pm1 = null;
    }
    if (pm2) {
      await pm2.stop();
      pm2 = null;
    }
  });

  describe('1. Full mTLS Handshake & Encrypted Channel Establishment', () => {
    test('1.1 should establish mutual TLS connection using Consortium CA and validator certs', async () => {
      const cm1 = new CertificateManager({
        certPem: val1Cert,
        keyPem: val1Key,
        caPem: caCert
      });

      const cm2 = new CertificateManager({
        certPem: val2Cert,
        keyPem: val2Key,
        caPem: caCert
      });

      const reg1 = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-02' }]
      });
      const reg2 = new PeerAuthorizationRegistry({
        initialPeers: [{ validatorId: 'VAL-01' }]
      });

      const config1 = new NetworkConfig({
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: port1,
        useTLS: true,
        tlsOptions: {
          key: val1Key,
          cert: val1Cert,
          ca: caCert,
          requestCert: true,
          rejectUnauthorized: true
        },
        peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
      });

      const config2 = new NetworkConfig({
        validatorId: 'VAL-02',
        listenHost: '127.0.0.1',
        listenPort: port2,
        useTLS: true,
        tlsOptions: {
          key: val2Key,
          cert: val2Cert,
          ca: caCert,
          requestCert: true,
          rejectUnauthorized: true
        },
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
      });

      const auth1 = new PeerAuthenticator('VAL-01');
      const auth2 = new PeerAuthenticator('VAL-02');

      pm1 = new PeerManager({
        config: config1,
        authenticator: auth1,
        certificateManager: cm1,
        peerAuthorizationRegistry: reg1
      });

      pm2 = new PeerManager({
        config: config2,
        authenticator: auth2,
        certificateManager: cm2,
        peerAuthorizationRegistry: reg2
      });

      await pm1.start();
      await pm2.start();

      // Await mutual connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('mTLS handshake timed out'));
        }, 5000);

        const check = () => {
          if (pm1.isConnectedTo('VAL-02') && pm2.isConnectedTo('VAL-01')) {
            clearTimeout(timeout);
            resolve();
          }
        };

        pm1.on('peer_connected', check);
        pm2.on('peer_connected', check);
        check();
      });

      expect(pm1.isConnectedTo('VAL-02')).toBe(true);
      expect(pm2.isConnectedTo('VAL-01')).toBe(true);

      // Verify connection properties
      const conn1 = pm1.peers.get('VAL-02');
      expect(conn1.isEncrypted).toBe(true);
      expect(conn1.peerCertificateFingerprint).toBeDefined();

      const json = conn1.toJSON();
      expect(json.isEncrypted).toBe(true);
      expect(json.peerCertificateFingerprint).toBeDefined();
    });

    test('1.2 should exchange encrypted application envelopes over established mTLS link', async () => {
      const cm1 = new CertificateManager({ certPem: val1Cert, keyPem: val1Key, caPem: caCert });
      const cm2 = new CertificateManager({ certPem: val2Cert, keyPem: val2Key, caPem: caCert });

      const config1 = new NetworkConfig({
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: port1,
        useTLS: true,
        tlsOptions: { key: val1Key, cert: val1Cert, ca: caCert, requestCert: true, rejectUnauthorized: true },
        peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
      });

      const config2 = new NetworkConfig({
        validatorId: 'VAL-02',
        listenHost: '127.0.0.1',
        listenPort: port2,
        useTLS: true,
        tlsOptions: { key: val2Key, cert: val2Cert, ca: caCert, requestCert: true, rejectUnauthorized: true },
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
      });

      pm1 = new PeerManager({ config: config1, authenticator: new PeerAuthenticator('VAL-01'), certificateManager: cm1 });
      pm2 = new PeerManager({ config: config2, authenticator: new PeerAuthenticator('VAL-02'), certificateManager: cm2 });

      await pm1.start();
      await pm2.start();

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        const check = () => {
          if (pm1.isConnectedTo('VAL-02')) {
            clearTimeout(timeout);
            resolve();
          }
        };
        pm1.on('peer_connected', check);
        check();
      });

      // Send test envelope
      const receivedPromise = new Promise((resolve) => {
        pm2.on('message', (envelope) => {
          if (envelope.type === MessageType.PROPOSAL) {
            resolve(envelope);
          }
        });
      });

      const testEnvelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: { round: 1, blockHash: '0x1234567890abcdef' }
      });

      pm1.peers.get('VAL-02').send(testEnvelope);

      const received = await receivedPromise;
      expect(received.senderId).toBe('VAL-01');
      expect(received.payload.blockHash).toBe('0x1234567890abcdef');
    });
  });

  describe('2. ValidatorProcess Health API Integration (/health/tls, /health/keys)', () => {
    let proc;
    const testApiPort = 19101;
    const testP2pPort = 19102;

    afterEach(async () => {
      if (proc) {
        await proc.stop('Test complete');
        proc = null;
      }
    });

    function httpGet(port, pathName) {
      return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: pathName }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, body: data });
            }
          });
        }).on('error', reject);
      });
    }

    test('2.1 should serve /health/tls and /health/keys endpoints accurately', async () => {
      proc = new ValidatorProcess({
        validatorId: 'VAL-01',
        apiPort: testApiPort,
        listenPort: testP2pPort,
        useTLS: true,
        tlsCaPath: path.join(fixturesDir, 'ca.crt'),
        tlsCertPath: path.join(fixturesDir, 'val-01.crt'),
        tlsKeyPath: path.join(fixturesDir, 'val-01.key')
      });

      await proc.start();

      // Test /health/tls
      const tlsRes = await httpGet(testApiPort, '/health/tls');
      expect(tlsRes.statusCode).toBe(200);
      expect(tlsRes.body.configured).toBe(true);
      expect(tlsRes.body.cn).toBe('VAL-01');
      expect(tlsRes.body.caConfigured).toBe(true);
      expect(tlsRes.body.isExpired).toBe(false);

      // Test /health/keys
      const keysRes = await httpGet(testApiPort, '/health/keys');
      expect(keysRes.statusCode).toBe(200);
      expect(keysRes.body.validatorId).toBe('VAL-01');
      expect(keysRes.body.keyStore).toBeDefined();
      expect(keysRes.body.keyStore.hasConsensusKey).toBe(true);
      expect(keysRes.body.rotation).toBeDefined();
      expect(keysRes.body.authorizations).toBeDefined();

      // Ensure NO secret leakage in response
      const jsonStr = JSON.stringify(keysRes.body);
      expect(jsonStr).not.toContain('PRIVATE KEY');
      expect(jsonStr).not.toContain('privateKey');
    });
  });
});
