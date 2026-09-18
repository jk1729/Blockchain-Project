/**
 * Phase 19: Structured Logger & Secret Redaction Test Suite
 */

const { StructuredLogger, defaultStructuredLogger } = require('../src/observability/StructuredLogger');
const RequestContext = require('../src/observability/RequestContext');

describe('Phase 19: Structured Logger & Secret Redaction', () => {
  let capturedOut = [];
  let capturedErr = [];

  const mockOutStream = {
    write: (data) => capturedOut.push(data)
  };
  const mockErrStream = {
    write: (data) => capturedErr.push(data)
  };

  beforeEach(() => {
    capturedOut = [];
    capturedErr = [];
  });

  describe('1. Structured JSON Output & Standard Fields', () => {
    test('should emit JSON with all standard fields when forceJson is enabled', () => {
      const logger = new StructuredLogger({
        environment: 'production',
        outStream: mockOutStream,
        errStream: mockErrStream
      });

      RequestContext.run({ requestId: 'req_test_123', traceId: 'trace_abc_456', spanId: 'span_789' }, () => {
        logger.info('Node initialized successfully', {
          component: 'CONSENSUS',
          event: 'NODE_BOOT',
          blockHeight: 1050
        });
      });

      expect(capturedOut.length).toBe(1);
      const parsed = JSON.parse(capturedOut[0]);
      expect(parsed.level).toBe('INFO');
      expect(parsed.message).toBe('Node initialized successfully');
      expect(parsed.component).toBe('CONSENSUS');
      expect(parsed.event).toBe('NODE_BOOT');
      expect(parsed.requestId).toBe('req_test_123');
      expect(parsed.traceId).toBe('trace_abc_456');
      expect(parsed.spanId).toBe('span_789');
      expect(parsed.blockHeight).toBe(1050);
      expect(parsed.timestamp).toBeDefined();
    });

    test('should route ERROR and FATAL logs to error stream', () => {
      const logger = new StructuredLogger({
        environment: 'production',
        outStream: mockOutStream,
        errStream: mockErrStream
      });

      logger.error('Database connection failed', { errorCode: 'DB_DOWN' });
      expect(capturedOut.length).toBe(0);
      expect(capturedErr.length).toBe(1);

      const parsed = JSON.parse(capturedErr[0]);
      expect(parsed.level).toBe('ERROR');
      expect(parsed.errorCode).toBe('DB_DOWN');
    });
  });

  describe('2. Multi-Layer Secret Redaction', () => {
    test('should redact RSA and EC private keys from log messages', () => {
      const fakeRsaKey = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0fakekeydata...\n-----END RSA PRIVATE KEY-----';
      const clean = StructuredLogger.redact(`Starting node with key: ${fakeRsaKey}`);
      expect(clean).not.toContain('fakekeydata');
      expect(clean).toContain('[REDACTED_SECRET]');
    });

    test('should redact passwords, seeds, and JWT tokens in objects', () => {
      const sensitiveObj = {
        username: 'admin',
        password: 'SuperSecretPassword123!',
        seedPhrase: 'apple banana cherry dog elephant fox grape horse igloo jaguar kite lion',
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisToken',
        nested: {
          privateKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          normalField: 'safeValue'
        }
      };

      const redacted = StructuredLogger.redact(sensitiveObj);
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.seedPhrase).toBe('[REDACTED]');
      expect(redacted.token).toBe('[REDACTED]');
      expect(redacted.nested.privateKey).toBe('[REDACTED]');
      expect(redacted.nested.normalField).toBe('safeValue');
      expect(redacted.username).toBe('admin');
    });

    test('should redact credentials in database connection URLs', () => {
      const url = 'postgres://pds_user:super_secret_db_pass@127.0.0.1:5432/pdschain';
      const clean = StructuredLogger.redact(url);
      expect(clean).not.toContain('super_secret_db_pass');
      expect(clean).toContain(':[REDACTED_CREDENTIAL]@');
    });
  });

  describe('3. Log Injection Prevention & Error Serialization', () => {
    test('should escape newlines in text mode to prevent log forging', () => {
      const maliciousInput = 'Normal log\n[ERROR] [2026-09-18T00:00:00Z] Faked admin override';
      const sanitized = StructuredLogger.sanitizeText(maliciousInput);
      expect(sanitized).not.toContain('\n');
      expect(sanitized).toContain('\\n[ERROR]');
    });

    test('should safely serialize Error instances without leaking internal secrets', () => {
      const err = new Error('Verification failed for privateKey=secretKey123');
      err.code = 'VERIFY_FAIL';
      err.details = { rawKey: 'secretKey123' };

      const serialized = StructuredLogger.serializeError(err);
      expect(serialized.name).toBe('Error');
      expect(serialized.code).toBe('VERIFY_FAIL');
      expect(serialized.message).toBe('Verification failed for privateKey=secretKey123');
    });
  });
});

