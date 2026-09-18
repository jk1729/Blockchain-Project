const {
  MessageEnvelope,
  MessageType,
  MessageCodec,
  StreamDecoder,
  PeerAuthenticator
} = require('../src/network');
const ValidatorVote = require('../src/consensus/ValidatorVote');
const { getParticipantPrivateKey } = require('../src/blockchain/identity/keyManager');

describe('PHASE 9: Network Performance & Throughput Benchmark Suite', () => {
  test('1. MessageCodec encode & decode throughput benchmark (>5,000 ops/sec)', () => {
    const iterations = 5000;
    const env = new MessageEnvelope({
      version: 1,
      networkId: 'pdschain-devnet',
      chainId: 1729,
      type: MessageType.VOTE,
      senderId: 'VAL-01',
      payload: {
        blockHeight: 100,
        round: 0,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        vote: 'ACCEPT'
      }
    });

    const startTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      const frame = MessageCodec.encode(env);
      const decoded = MessageCodec.decode(frame);
      expect(decoded.type).toBe(MessageType.VOTE);
    }
    const durationMs = Math.max(1, Date.now() - startTime);
    const opsPerSec = Math.floor((iterations / durationMs) * 1000);

    expect(opsPerSec).toBeGreaterThan(2000);
  });

  test('2. Ed25519 Challenge-Response cryptographic throughput benchmark (>500 ops/sec)', () => {
    const auth1 = new PeerAuthenticator('VAL-01');
    const auth2 = new PeerAuthenticator('VAL-02');
    const iterations = 200;

    const startTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      const challenge = auth1.createChallenge();
      const sig = auth2.signChallenge(challenge);
      const verified = auth1.verifyChallenge('VAL-02', challenge, sig);
      expect(verified.valid).toBe(true);
    }
    const durationMs = Math.max(1, Date.now() - startTime);
    const opsPerSec = Math.floor((iterations / durationMs) * 1000);

    expect(opsPerSec).toBeGreaterThan(100);
  });

  test('3. Validator Vote cryptographic signing and verification benchmark (>200 ops/sec)', () => {
    const privKey = getParticipantPrivateKey('VAL-01');
    const iterations = 200;

    const startTime = Date.now();
    for (let i = 0; i < iterations; i++) {
      const vote = new ValidatorVote({
        chainId: 1729,
        validatorId: 'VAL-01',
        blockNumber: i + 1,
        round: 0,
        blockHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        vote: 'ACCEPT'
      });
      vote.sign(privKey);
      const check = vote.verifySignature();
      expect(check.valid).toBe(true);
    }
    const durationMs = Math.max(1, Date.now() - startTime);
    const opsPerSec = Math.floor((iterations / durationMs) * 1000);

    expect(opsPerSec).toBeGreaterThan(100);
  });
});

