const {
  NetworkConfig,
  MessageEnvelope,
  MessageType,
  TLSTransport,
  PeerAuthenticator,
  PeerManager,
  NetworkMetrics
} = require('../src/network');

describe('PHASE 9: Network Transport & Peer Handshake Test Suite', () => {
  let auth1;
  let auth2;

  beforeAll(() => {
    auth1 = new PeerAuthenticator('VAL-01');
    auth2 = new PeerAuthenticator('VAL-02');
  });

  describe('1. PeerAuthenticator Challenge-Response', () => {
    test('1. should generate unique challenges and verify valid Ed25519 signatures', () => {
      const challenge1 = auth1.createChallenge();
      const challenge2 = auth1.createChallenge();
      expect(challenge1).not.toBe(challenge2);
      expect(challenge1.length).toBe(64); // 32 bytes hex

      const sig = auth1.signChallenge(challenge1);
      expect(sig).toBeTruthy();

      const verified = auth1.verifyChallenge('VAL-01', challenge1, sig);
      expect(verified.validatorId).toBe('VAL-01');
      expect(verified.address).toBeTruthy();
      expect(verified.publicKey).toBeTruthy();
    });

    test('2. should reject invalid signatures or tampered challenges', () => {
      const challenge = auth1.createChallenge();
      const sig = auth1.signChallenge(challenge);

      // Tampered challenge (guaranteed to differ)
      const tamperedChallenge = challenge.endsWith('00')
        ? challenge.slice(0, -2) + 'ff'
        : challenge.slice(0, -2) + '00';
      expect(() => {
        auth1.verifyChallenge('VAL-01', tamperedChallenge, sig);
      }).toThrow(/signature verification failed/);

      // Wrong validator
      expect(() => {
        auth1.verifyChallenge('VAL-02', challenge, sig);
      }).toThrow(/signature verification failed/);
    });
  });

  describe('2. PeerManager P2P Connection & Handshake', () => {
    test('3. should establish mutual authenticated P2P connection and exchange messages', async () => {
      const port1 = 15001;
      const port2 = 15002;

      const config1 = new NetworkConfig({
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: port1,
        tls: false,
        peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
      });

      const config2 = new NetworkConfig({
        validatorId: 'VAL-02',
        listenHost: '127.0.0.1',
        listenPort: port2,
        tls: false,
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
      });

      const pm1 = new PeerManager({ config: config1, authenticator: auth1 });
      const pm2 = new PeerManager({ config: config2, authenticator: auth2 });

      try {
        await pm1.start();
        await pm2.start();

        // Wait for handshake completion
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Handshake timeout! PM1: ${pm1.peers.size}, PM2: ${pm2.peers.size}`));
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

        // Verify message transfer between authenticated peers
        const messagePromise = new Promise((resolve) => {
          pm2.on('message', (env, conn) => {
            if (env.type === MessageType.PROPOSAL) {
              resolve({ env, conn });
            }
          });
        });

        const testEnvelope = new MessageEnvelope({
          version: 1,
          networkId: 'pdschain-devnet',
          chainId: 1729,
          type: MessageType.PROPOSAL,
          senderId: 'VAL-01',
          payload: { blockHeight: 1, blockHash: '0xabc123' }
        });

        pm1.sendTo('VAL-02', testEnvelope);

        const received = await messagePromise;
        expect(received.env.type).toBe(MessageType.PROPOSAL);
        expect(received.env.payload.blockHash).toBe('0xabc123');
        expect(received.conn.peerValidatorId).toBe('VAL-01');

        // Verify broadcast
        const broadcastPromise = new Promise((resolve) => {
          pm2.on('message', (env) => {
            if (env.type === MessageType.VOTE) {
              resolve(env);
            }
          });
        });

        const voteEnvelope = new MessageEnvelope({
          version: 1,
          networkId: 'pdschain-devnet',
          chainId: 1729,
          type: MessageType.VOTE,
          senderId: 'VAL-01',
          payload: { round: 1, voteType: 'COMMIT' }
        });

        const count = pm1.broadcast(voteEnvelope);
        expect(count).toBe(1);

        const recVote = await broadcastPromise;
        expect(recVote.payload.voteType).toBe('COMMIT');

        // Verify metrics
        const status1 = pm1.getStatus();
        expect(status1.activePeerCount).toBe(1);
        expect(status1.metrics.messagesSentTotal[MessageType.VOTE]).toBeGreaterThanOrEqual(1);
      } finally {
        await pm1.stop();
        await pm2.stop();
      }
    });

    test('4. should run TLS transport handshake with self-signed dev certificates', async () => {
      const port1 = 15003;
      const port2 = 15004;

      const config1 = new NetworkConfig({
        validatorId: 'VAL-01',
        listenHost: '127.0.0.1',
        listenPort: port1,
        tls: true,
        peers: [{ validatorId: 'VAL-02', host: '127.0.0.1', port: port2 }]
      });

      const config2 = new NetworkConfig({
        validatorId: 'VAL-02',
        listenHost: '127.0.0.1',
        listenPort: port2,
        tls: true,
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: port1 }]
      });

      const pm1 = new PeerManager({ config: config1, authenticator: auth1 });
      const pm2 = new PeerManager({ config: config2, authenticator: auth2 });

      try {
        await pm1.start();
        await pm2.start();

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('TLS Handshake timeout'));
          }, 6000);

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
      } finally {
        await pm1.stop();
        await pm2.stop();
      }
    });
  });
});

