const EventEmitter = require('events');
const { MessageEnvelope } = require('./MessageEnvelope');
const { NetworkErrorCode, NetworkError } = require('./NetworkErrors');

const DEFAULT_MAX_FRAME_SIZE = 4 * 1024 * 1024; // 4 MB

class MessageCodec {
  /**
   * Encode a MessageEnvelope into a length-prefixed Buffer
   * [ 4-byte big-endian UInt32 length ][ UTF-8 JSON payload ]
   * 
   * @param {MessageEnvelope|object} envelope 
   * @param {number} [maxFrameSize=4194304] 
   * @returns {Buffer}
   */
  static encode(envelope, maxFrameSize = DEFAULT_MAX_FRAME_SIZE) {
    if (!envelope) {
      throw new NetworkError(NetworkErrorCode.MALFORMED_ENVELOPE, 'Cannot encode null or undefined envelope');
    }

    const jsonStr = JSON.stringify(envelope.toJSON ? envelope.toJSON() : envelope);
    const payloadBuf = Buffer.from(jsonStr, 'utf8');

    if (payloadBuf.length > maxFrameSize) {
      throw new NetworkError(
        NetworkErrorCode.OVERSIZED_FRAME,
        `Frame payload size (${payloadBuf.length} bytes) exceeds maximum limit of ${maxFrameSize} bytes`
      );
    }

    const frameBuf = Buffer.allocUnsafe(4 + payloadBuf.length);
    frameBuf.writeUInt32BE(payloadBuf.length, 0);
    payloadBuf.copy(frameBuf, 4);

    return frameBuf;
  }

  /**
   * Decode a single complete length-prefixed Buffer into a MessageEnvelope
   * @param {Buffer} frameBuffer 
   * @returns {MessageEnvelope}
   */
  static decode(frameBuffer) {
    if (!frameBuffer || frameBuffer.length < 4) {
      throw new NetworkError(NetworkErrorCode.MALFORMED_ENVELOPE, 'Frame buffer too short');
    }
    const len = frameBuffer.readUInt32BE(0);
    const jsonStr = frameBuffer.toString('utf8', 4, 4 + len);
    const parsed = JSON.parse(jsonStr);
    return MessageEnvelope.fromJSON(parsed);
  }
}

/**
 * StreamDecoder
 * Stateful streaming decoder that handles TCP stream chunking, partial reads,
 * multiple concatenated frames in a single chunk, and oversized frame guards.
 */
class StreamDecoder extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.maxFrameSize=4194304]
   */
  constructor(options = {}) {
    super();
    this.maxFrameSize = parseInt(options.maxFrameSize, 10) || DEFAULT_MAX_FRAME_SIZE;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Push incoming socket byte chunk into decoder
   * @param {Buffer} chunk 
   */
  push(chunk) {
    if (!chunk || chunk.length === 0) return;

    this.buffer = Buffer.concat([this.buffer, chunk]);

    // Protect against unbounded buffer memory growth
    if (this.buffer.length > this.maxFrameSize * 2) {
      this.reset();
      const err = new NetworkError(
        NetworkErrorCode.OVERSIZED_FRAME,
        'Stream buffer exceeded maximum safe capacity'
      );
      this.emit('error', err);
      return;
    }

    this._processBuffer();
  }

  _processBuffer() {
    while (this.buffer.length >= 4) {
      const frameLength = this.buffer.readUInt32BE(0);

      // Guard: Frame size exceeds configured upper bound
      if (frameLength > this.maxFrameSize) {
        const err = new NetworkError(
          NetworkErrorCode.OVERSIZED_FRAME,
          `Incoming frame length (${frameLength} bytes) exceeds maximum limit (${this.maxFrameSize} bytes)`
        );
        this.reset();
        this.emit('error', err);
        return;
      }

      // Guard: Negative or zero length frame
      if (frameLength === 0) {
        this.buffer = this.buffer.slice(4);
        continue;
      }

      // Wait for complete frame if partial
      if (this.buffer.length < 4 + frameLength) {
        return; // Need more bytes from network
      }

      // Complete frame arrived
      const payloadBytes = this.buffer.slice(4, 4 + frameLength);
      this.buffer = this.buffer.slice(4 + frameLength);

      try {
        const jsonStr = payloadBytes.toString('utf8');
        const parsedData = JSON.parse(jsonStr);
        const envelope = MessageEnvelope.fromJSON(parsedData);
        this.emit('message', envelope);
      } catch (parseErr) {
        const err = new NetworkError(
          NetworkErrorCode.DECODE_ERROR,
          `Failed to parse frame JSON payload: ${parseErr.message}`
        );
        this.emit('error', err);
      }
    }
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = {
  MessageCodec,
  StreamDecoder,
  DEFAULT_MAX_FRAME_SIZE
};
