const path = require('path');
const os = require('os');
const dotenv = require('dotenv');

// Load .env from backend root if present
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const DEFAULT_DEV_JWT_SECRET = 'pdschain_dev_super_secret_jwt_key_2026';

function validateConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const jwtSecret = env.JWT_SECRET;
  const corsOrigin = env.CORS_ORIGIN;

  if (nodeEnv === 'production') {
    if (!jwtSecret || jwtSecret.trim() === '') {
      throw new Error('CONFIG ERROR: JWT_SECRET must be explicitly set in production.');
    }
    if (jwtSecret === DEFAULT_DEV_JWT_SECRET) {
      throw new Error('CONFIG ERROR: Insecure development JWT_SECRET fallback cannot be used in production.');
    }
    if (jwtSecret.length < 32) {
      throw new Error('CONFIG ERROR: JWT_SECRET must be at least 32 characters long in production.');
    }
    if (!corsOrigin || corsOrigin.trim() === '' || corsOrigin.trim() === '*') {
      throw new Error('CONFIG ERROR: Unrestricted wildcard CORS_ORIGIN is not permitted in production. Explicit allowed origins must be configured.');
    }
  }
}

// Automatically validate on load if running in production
if (process.env.NODE_ENV === 'production') {
  validateConfig(process.env);
}

module.exports = {
  get PORT() {
    return process.env.PORT || 3000;
  },
  get NODE_ENV() {
    return process.env.NODE_ENV || 'development';
  },
  get DATABASE_URL() {
    return process.env.DATABASE_URL || '';
  },
  get DATABASE_STORAGE() {
    if (process.env.DATABASE_STORAGE) {
      return path.resolve(__dirname, '../../', process.env.DATABASE_STORAGE);
    }
    if (process.env.NODE_ENV === 'test') {
      return path.join(os.tmpdir(), 'pdschain-test-isolated', 'pdschain-test.sqlite');
    }
    return path.resolve(__dirname, '../../../database/pdschain.sqlite');
  },
  get EVENTS_JOURNAL_PATH() {
    if (process.env.EVENTS_JOURNAL_PATH) {
      return path.resolve(process.env.EVENTS_JOURNAL_PATH);
    }
    if (process.env.NODE_ENV === 'test') {
      return path.join(os.tmpdir(), 'pdschain-test-isolated', 'events_journal_test.jsonl');
    }
    return path.resolve(process.cwd(), 'database/events_journal.jsonl');
  },
  get SECURITY_AUDIT_PATH() {
    if (process.env.SECURITY_AUDIT_PATH) {
      return path.resolve(process.env.SECURITY_AUDIT_PATH);
    }
    if (process.env.NODE_ENV === 'test') {
      return path.join(os.tmpdir(), 'pdschain-test-isolated', 'security_audit_test.jsonl');
    }
    return path.resolve(process.cwd(), 'database/security_audit.jsonl');
  },
  get JWT_SECRET() {
    return process.env.JWT_SECRET || DEFAULT_DEV_JWT_SECRET;
  },
  get JWT_EXPIRES_IN() {
    return process.env.JWT_EXPIRES_IN || '24h';
  },
  get BLOCKCHAIN_DIFFICULTY() {
    return parseInt(process.env.BLOCKCHAIN_DIFFICULTY, 10) || 2;
  },
  get VALIDATOR_COUNT() {
    return parseInt(process.env.VALIDATOR_COUNT, 10) || 12;
  },
  get CORS_ORIGIN() {
    return process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*');
  },
  DEFAULT_DEV_JWT_SECRET,
  validateConfig
};

