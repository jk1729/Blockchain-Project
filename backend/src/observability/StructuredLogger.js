/**
 * PDSChain Structured Logger (Phase 19)
 * 
 * Provides production-grade JSON structured logging, context propagation via RequestContext,
 * multi-tier secret redaction, error serialization, and log-injection protection.
 */

const RequestContext = require('./RequestContext');

const LOG_LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50
});

const SENSITIVE_REGEXES = [
  // RSA & EC Private Keys
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
  // Hex private keys / seeds (32-byte 64-hex preceded by key words)
  /(?:private[_-]?key|seed[_-]?phrase|mnemonic|secret[_-]?key|passphrase)\s*[:=]\s*["']?([0-9a-fA-F]{64}|[a-zA-Z0-9\s]{24,})["']?/gi,
  // JSON key-values for sensitive fields
  /("(?:privateKey|secret|password|seed|passphrase|token|apiKey|authorization)"\s*:\s*)"[^"]+"/gi,
  // Bearer tokens and JWTs
  /Bearer\s+[^\s"',]+/gi,
  // Connection strings with embedded credentials
  /(postgres(?:ql)?|mysql|mongodb|redis):\/\/[^:]+:([^@]+)@/gi,
  // Development keys
  /PDSCHAIN_DEV_KEY:[^\s",]+/g
];

class StructuredLogger {
  constructor(options = {}) {
    this.service = options.service || process.env.SERVICE_NAME || 'pdschain-backend';
    this.environment = options.environment || process.env.NODE_ENV || 'development';
    this.defaultComponent = options.component || 'SYSTEM';
    this.outStream = options.outStream || process.stdout;
    this.errStream = options.errStream || process.stderr;

    // Configured minimum log level
    const envLevel = (process.env.LOG_LEVEL || (this.environment === 'test' ? 'warn' : 'info')).toLowerCase();
    this.minLevel = LOG_LEVELS[envLevel] || LOG_LEVELS.info;
    this.forceJson = process.env.LOG_FORMAT === 'json' || this.environment === 'production';
  }

  /**
   * Deep recursive secret redaction
   * @param {*} input 
   * @returns {*}
   */
  static redact(input) {
    if (input === null || input === undefined) return input;

    if (typeof input === 'string') {
      let cleaned = input;
      for (const regex of SENSITIVE_REGEXES) {
        cleaned = cleaned.replace(regex, (match) => {
          if (match.startsWith('Bearer')) return 'Bearer [REDACTED_JWT]';
          if (match.includes('://')) return match.replace(/:[^@]+@/, ':[REDACTED_CREDENTIAL]@');
          return '[REDACTED_SECRET]';
        });
      }
      return cleaned;
    }

    if (Array.isArray(input)) {
      return input.map(item => StructuredLogger.redact(item));
    }

    if (typeof input === 'object') {
      const cleanObj = {};
      for (const [key, value] of Object.entries(input)) {
        const lowerKey = key.toLowerCase();
        if (
          lowerKey.includes('password') ||
          lowerKey.includes('privatekey') ||
          lowerKey.includes('secret') ||
          lowerKey.includes('seed') ||
          lowerKey.includes('token') ||
          lowerKey.includes('passphrase') ||
          lowerKey.includes('authorization')
        ) {
          cleanObj[key] = '[REDACTED]';
        } else {
          cleanObj[key] = StructuredLogger.redact(value);
        }
      }
      return cleanObj;
    }

    return input;
  }

  /**
   * Escape line feeds in text mode to prevent log injection
   * @param {string} str 
   * @returns {string}
   */
  static sanitizeText(str) {
    if (typeof str !== 'string') return String(str);
    return str.replace(/\r?\n/g, '\\n').replace(/\r/g, '\\r');
  }

  /**
   * Safe serialization of Error instances
   * @param {*} err 
   * @returns {object}
   */
  static serializeError(err) {
    if (!(err instanceof Error)) return err;
    const serialized = {
      name: err.name || 'Error',
      message: err.message || '',
      code: err.code || undefined
    };

    // Include stack trace only when enabled or in dev/test
    if (process.env.LOG_STACK_TRACES === 'true' || process.env.NODE_ENV !== 'production') {
      serialized.stack = err.stack;
    }
    if (err.details) {
      serialized.details = StructuredLogger.redact(err.details);
    }
    return serialized;
  }

  /**
   * Core logging function
   * @param {string} levelName 
   * @param {string} message 
   * @param {object} [meta={}] 
   */
  log(levelName, message, meta = {}) {
    // In test environment, skip unless TEST_LOGS is set
    if (this.environment === 'test' && !process.env.TEST_LOGS) {
      return;
    }

    const levelCode = LOG_LEVELS[levelName.toLowerCase()] || LOG_LEVELS.info;
    if (levelCode < this.minLevel) return;

    try {
      const ctx = RequestContext.current();
      const timestamp = new Date().toISOString();

      // Normalize error if meta is an Error instance
      let errorData = undefined;
      let metaPayload = { ...meta };

      if (meta instanceof Error) {
        errorData = StructuredLogger.serializeError(meta);
        metaPayload = {};
      } else if (meta && meta.error instanceof Error) {
        errorData = StructuredLogger.serializeError(meta.error);
        delete metaPayload.error;
      }

      // Redact message and meta payload
      const cleanMessage = StructuredLogger.redact(typeof message === 'string' ? message : JSON.stringify(message));
      const cleanMeta = StructuredLogger.redact(metaPayload);

      // Build structured payload
      const logRecord = {
        timestamp,
        level: levelName.toUpperCase(),
        service: this.service,
        environment: this.environment,
        component: cleanMeta.component || ctx.component || this.defaultComponent,
        event: cleanMeta.event || undefined,
        message: cleanMessage,
        requestId: cleanMeta.requestId || ctx.requestId || undefined,
        traceId: cleanMeta.traceId || ctx.traceId || undefined,
        spanId: cleanMeta.spanId || ctx.spanId || undefined,
        nodeId: cleanMeta.nodeId || ctx.nodeId || undefined,
        validatorId: cleanMeta.validatorId || ctx.validatorId || undefined,
        blockHeight: cleanMeta.blockHeight !== undefined ? cleanMeta.blockHeight : undefined,
        txHash: cleanMeta.txHash || undefined,
        durationMs: cleanMeta.durationMs !== undefined ? cleanMeta.durationMs : undefined,
        errorCode: cleanMeta.errorCode || (errorData && errorData.code) || undefined,
        error: errorData,
        ...cleanMeta
      };

      // Remove redundant fields from root if already mapped
      delete logRecord.component;
      delete logRecord.event;
      delete logRecord.requestId;
      delete logRecord.traceId;
      delete logRecord.spanId;
      delete logRecord.nodeId;
      delete logRecord.validatorId;
      delete logRecord.blockHeight;
      delete logRecord.txHash;
      delete logRecord.durationMs;
      delete logRecord.errorCode;

      // Re-assign mapped fields cleanly in standard order
      const finalEntry = {
        timestamp,
        level: levelName.toUpperCase(),
        service: this.service,
        environment: this.environment,
        component: cleanMeta.component || ctx.component || this.defaultComponent,
        event: cleanMeta.event || undefined,
        message: cleanMessage,
        requestId: cleanMeta.requestId || ctx.requestId || undefined,
        traceId: cleanMeta.traceId || ctx.traceId || undefined,
        spanId: cleanMeta.spanId || ctx.spanId || undefined,
        nodeId: cleanMeta.nodeId || ctx.nodeId || undefined,
        validatorId: cleanMeta.validatorId || ctx.validatorId || undefined,
        blockHeight: cleanMeta.blockHeight !== undefined ? cleanMeta.blockHeight : undefined,
        txHash: cleanMeta.txHash || undefined,
        durationMs: cleanMeta.durationMs !== undefined ? cleanMeta.durationMs : undefined,
        errorCode: cleanMeta.errorCode || (errorData && errorData.code) || undefined,
        error: errorData,
        ...cleanMeta
      };

      // Purge undefined keys for clean JSON output
      for (const k of Object.keys(finalEntry)) {
        if (finalEntry[k] === undefined) delete finalEntry[k];
      }

      if (this.forceJson) {
        const jsonStr = JSON.stringify(finalEntry) + '\n';
        if (levelCode >= LOG_LEVELS.error) {
          this.errStream.write(jsonStr);
        } else {
          this.outStream.write(jsonStr);
        }
      } else {
        // Text format with log-injection protection
        const sanitizedMsg = StructuredLogger.sanitizeText(cleanMessage);
        const reqPrefix = finalEntry.requestId ? ` [${finalEntry.requestId}]` : '';
        const compPrefix = ` [${finalEntry.component}]`;
        const textLine = `[${finalEntry.level}] [${timestamp}]${compPrefix}${reqPrefix} ${sanitizedMsg}`;
        
        if (levelCode >= LOG_LEVELS.error) {
          this.errStream.write(textLine + '\n');
        } else {
          this.outStream.write(textLine + '\n');
        }
      }
    } catch (loggingErr) {
      // Fallback to stderr if serialization fails to avoid crashing caller
      try {
        process.stderr.write(`[LOGGER_FALLBACK_ERROR] Failed to log: ${loggingErr.message}\n`);
      } catch (_) {}
    }
  }

  debug(msg, meta) { this.log('debug', msg, meta); }
  info(msg, meta) { this.log('info', msg, meta); }
  warn(msg, meta) { this.log('warn', msg, meta); }
  error(msg, meta) { this.log('error', msg, meta); }
  fatal(msg, meta) { this.log('fatal', msg, meta); }

  // Phase-specific domain loggers
  consensus(msg, meta) {
    this.log('info', msg, { component: 'FBA-CONSENSUS', ...meta });
  }

  execution(msg, meta) {
    this.log('info', msg, { component: 'EXECUTION-ENGINE', ...meta });
  }

  withComponent(componentName) {
    return new Proxy(this, {
      get(target, prop) {
        if (['debug', 'info', 'warn', 'error', 'fatal'].includes(prop)) {
          return (msg, meta = {}) => target.log(prop, msg, { component: componentName, ...meta });
        }
        return target[prop];
      }
    });
  }
}

const defaultStructuredLogger = new StructuredLogger();

module.exports = {
  LOG_LEVELS,
  StructuredLogger,
  defaultStructuredLogger
};
