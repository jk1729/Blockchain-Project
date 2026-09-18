const { MessageEnvelope, MessageType } = require('../src/network/MessageEnvelope');
const { MessageCodec, StreamDecoder } = require('../src/network/MessageCodec');
const NetworkConfig = require('../src/network/NetworkConfig');
const { NetworkErrorCode, NetworkError } = require('../src/network/NetworkErrors');

describe('PHASE 9: Network Config, Envelopes & Framing Codec Test Suite', () => {

  // =========================================================================
  // 1. NetworkConfig Validation
  // =========================================================================
  describe('1. Network Configuration & Validation', () => {
    test('1. should construct valid config for VAL-01', () => {
      const config = NetworkConfig.forValidator('VAL-01');
      expect(config.validatorId).toBe('VAL-01');
      expect(config.listenPort).toBe(5001);
      expect(config.peers.length).toBe(11);
      expect(config.validate()).toBe(true);
    });

    test('2. should reject missing validatorId', () => {
      const config = new NetworkConfig({ validatorId: '', listenPort: 5001 });
      expect(() => config.validate()).toThrow(NetworkError);
      expect(() => config.validate()).toThrow(/validatorId is required/);
    });

    test('3. should reject invalid port number', () => {
      const config = new NetworkConfig({ validatorId: 'VAL-01', listenPort: 70000 });
      expect(() => config.validate()).toThrow(/Invalid listenPort/);
    });

    test('4. should reject self in peer list', () => {
      const config = new NetworkConfig({
        validatorId: 'VAL-01',
        listenPort: 5001,
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: 5001 }]
      });
      expect(() => config.validate()).toThrow(/Cannot list self/);
    });

    test('5. should reject duplicate peers in peer list', () => {
      const config = new NetworkConfig({
        validatorId: 'VAL-01',
        listenPort: 5001,
        peers: [
          { validatorId: 'VAL-02', host: '127.0.0.1', port: 5002 },
          { validatorId: 'VAL-02', host: '127.0.0.1', port: 5002 }
        ]
      });
      expect(() => config.validate()).toThrow(/Duplicate peer/);
    });
  });

  // =========================================================================
  // 2. MessageEnvelope Structure & Validation
  // =========================================================================
  describe('2. MessageEnvelope Structure & Validation', () => {
    test('6. should construct and validate a valid proposal envelope', () => {
      const envelope = new MessageEnvelope({
        version: 1,
        networkId: 'pdschain-mainnet',
        chainId: 1729,
        type: MessageType.PROPOSAL,
        senderId: 'VAL-01',
        payload: { blockNumber: 1, blockHash: '0xhash1' }
      });

      expect(envelope.messageId).toMatch(/^MSG-[a-f0-9]{32}$/);
      expect(envelope.validate({ networkId: 'pdschain-mainnet', chainId: 1729, protocolVersion: 1 })).toBe(true);
    });

    test('7. should reject unknown message type', () => {
      const envelope = new MessageEnvelope({
        type: 'INVALID_TYPE',
        senderId: 'VAL-01'
      });
      expect(() => envelope.validate()).toThrow(/Unknown message type/);
    });

    test('8. should reject networkId mismatch', () => {
      const envelope = new MessageEnvelope({
        networkId: 'pdschain-testnet',
        type: MessageType.VOTE,
        senderId: 'VAL-02'
      });
      expect(() => envelope.validate({ networkId: 'pdschain-mainnet' })).toThrow(/Network ID mismatch/);
    });

    test('9. should reject chainId mismatch', () => {
      const envelope = new MessageEnvelope({
        chainId: 9999,
        type: MessageType.VOTE,
        senderId: 'VAL-02'
      });
      expect(() => envelope.validate({ chainId: 1729 })).toThrow(/Chain ID mismatch/);
    });
  });

  // =========================================================================
  // 3. Length-Prefixed Framing & StreamDecoder
  // =========================================================================
  describe('3. MessageCodec & StreamDecoder', () => {
    test('10. should encode an envelope with 4-byte length prefix and decode successfully', (done) => {
      const envelope = new MessageEnvelope({
        type: MessageType.HEARTBEAT,
        senderId: 'VAL-01',
        payload: { ping: true }
      });

      const frame = MessageCodec.encode(envelope);
      expect(frame.length).toBeGreaterThan(4);
      const lengthPrefix = frame.readUInt32BE(0);
      expect(lengthPrefix).toBe(frame.length - 4);

      const decoder = new StreamDecoder();
      decoder.on('message', (msg) => {
        expect(msg.type).toBe(MessageType.HEARTBEAT);
        expect(msg.senderId).toBe('VAL-01');
        expect(msg.payload.ping).toBe(true);
        done();
      });

      decoder.push(frame);
    });

    test('11. should handle partial reads across multiple TCP chunks', (done) => {
      const envelope = new MessageEnvelope({
        type: MessageType.VOTE,
        senderId: 'VAL-03',
        payload: { blockNumber: 10, vote: 'ACCEPT' }
      });

      const frame = MessageCodec.encode(envelope);
      const decoder = new StreamDecoder();

      decoder.on('message', (msg) => {
        expect(msg.type).toBe(MessageType.VOTE);
        expect(msg.senderId).toBe('VAL-03');
        expect(msg.payload.blockNumber).toBe(10);
        done();
      });

      // Split into 3 arbitrary byte chunks
      const chunk1 = frame.slice(0, 5); // 4-byte length + 1 byte payload
      const chunk2 = frame.slice(5, 20);
      const chunk3 = frame.slice(20);

      decoder.push(chunk1);
      decoder.push(chunk2);
      decoder.push(chunk3);
    });

    test('12. should handle multiple concatenated frames arriving in a single socket read', (done) => {
      const msg1 = new MessageEnvelope({ type: MessageType.HEARTBEAT, senderId: 'VAL-01' });
      const msg2 = new MessageEnvelope({ type: MessageType.PROPOSAL, senderId: 'VAL-02' });

      const frame1 = MessageCodec.encode(msg1);
      const frame2 = MessageCodec.encode(msg2);
      const combined = Buffer.concat([frame1, frame2]);

      const received = [];
      const decoder = new StreamDecoder();

      decoder.on('message', (msg) => {
        received.push(msg);
        if (received.length === 2) {
          expect(received[0].type).toBe(MessageType.HEARTBEAT);
          expect(received[1].type).toBe(MessageType.PROPOSAL);
          done();
        }
      });

      decoder.push(combined);
    });

    test('13. should reject oversized frames before allocating memory buffer', (done) => {
      const decoder = new StreamDecoder({ maxFrameSize: 100 }); // Low max frame size

      decoder.on('error', (err) => {
        expect(err.code).toBe(NetworkErrorCode.OVERSIZED_FRAME);
        done();
      });

      // Construct a fake frame with 1000 byte length header
      const fakeHeader = Buffer.alloc(4);
      fakeHeader.writeUInt32BE(1000, 0);
      decoder.push(fakeHeader);
    });

    test('14. should handle malformed JSON payload safely', (done) => {
      const decoder = new StreamDecoder();

      decoder.on('error', (err) => {
        expect(err.code).toBe(NetworkErrorCode.DECODE_ERROR);
        done();
      });

      const badPayload = Buffer.from('NOT_VALID_JSON', 'utf8');
      const frame = Buffer.alloc(4 + badPayload.length);
      frame.writeUInt32BE(badPayload.length, 0);
      badPayload.copy(frame, 4);

      decoder.push(frame);
    });
  });
});

