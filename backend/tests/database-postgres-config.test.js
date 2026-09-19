const env = require('../src/config/env');
const { DatabaseManager } = require('../src/database/DatabaseManager');
const { seedDatabase } = require('../src/seed/seedDatabase');

describe('PostgreSQL Configuration & Production Safety Verification', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Environment & Dialect Configuration', () => {
    it('should default to sqlite in test/development if DB_DIALECT is not specified', () => {
      delete process.env.DB_DIALECT;
      delete process.env.DATABASE_URL;
      expect(env.DB_DIALECT).toBe('sqlite');
    });

    it('should respect DB_DIALECT=postgres when explicitly set', () => {
      process.env.DB_DIALECT = 'postgres';
      expect(env.DB_DIALECT).toBe('postgres');
    });

    it('should infer postgres dialect from DATABASE_URL protocol', () => {
      delete process.env.DB_DIALECT;
      process.env.DATABASE_URL = 'postgres://pds_user:secure_pwd@postgres.internal:5432/pdschain';
      expect(env.DB_DIALECT).toBe('postgres');
    });

    it('should require DATABASE_URL in production when DB_DIALECT=postgres', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a_very_secure_production_jwt_secret_with_32_chars';
      process.env.CORS_ORIGIN = 'https://pdschain.gov.in';
      process.env.DB_DIALECT = 'postgres';
      delete process.env.DATABASE_URL;
      expect(() => env.validate()).toThrow(/DATABASE_URL must be explicitly configured/);
    });

    it('should pass validation in production when valid DATABASE_URL is provided', () => {
      process.env.NODE_ENV = 'production';
      process.env.DB_DIALECT = 'postgres';
      process.env.DATABASE_URL = 'postgres://pds_user:secure_pwd@postgres.internal:5432/pdschain';
      process.env.JWT_SECRET = 'a_very_secure_production_jwt_secret_with_32_chars';
      process.env.CORS_ORIGIN = 'https://pdschain.gov.in';
      expect(() => env.validate()).not.toThrow();
    });
  });

  describe('2. DatabaseManager PostgreSQL Initialization Options', () => {
    it('should configure Sequelize with postgres dialect and connection pool', () => {
      const manager = new DatabaseManager({
        dialect: 'postgres',
        url: 'postgres://pds_user:secure_pass@localhost:5432/pdschain_db',
        pool: {
          max: 25,
          min: 5,
          acquire: 30000,
          idle: 10000
        }
      });

      expect(manager.dialect).toBe('postgres');
      expect(manager.databaseUrl).toBe('postgres://pds_user:secure_pass@localhost:5432/pdschain_db');
      expect(manager.sequelize.options.dialect).toBe('postgres');
      expect(manager.sequelize.options.pool.max).toBe(25);
      expect(manager.sequelize.options.pool.min).toBe(5);
    });

    it('should configure SSL options for production postgres environments', () => {
      const oldNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const manager = new DatabaseManager({
          dialect: 'postgres',
          url: 'postgres://pds_user:secure_pass@cloud-db.internal:5432/pdschain_db',
          ssl: true
        });

        expect(manager.sequelize.options.dialectOptions).toBeDefined();
        expect(manager.sequelize.options.dialectOptions.ssl).toBeDefined();
        expect(manager.sequelize.options.dialectOptions.ssl.require).toBe(true);
      } finally {
        process.env.NODE_ENV = oldNodeEnv;
      }
    });

    it('should forbid force: true in production during syncSafe', async () => {
      const oldNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const manager = new DatabaseManager({ dialect: 'sqlite', storage: ':memory:' });

      try {
        await expect(manager.syncSafe({ force: true })).rejects.toThrow(
          /FATAL SAFETY ERROR: Destructive database sync/
        );
      } finally {
        process.env.NODE_ENV = oldNodeEnv;
      }
    });
  });

  describe('3. Seed Production Guard', () => {
    it('should prevent destructive database wipe in production mode', async () => {
      const oldNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        await expect(seedDatabase(true)).rejects.toThrow(
          /FATAL SAFETY ERROR: Destructive seeding/
        );
      } finally {
        process.env.NODE_ENV = oldNodeEnv;
      }
    });
  });

  describe('4. Sequelize Model Schema Dialect Compatibility', () => {
    it('should ensure all core models have explicit primary keys and standard data types', () => {
      const db = require('../src/models');
      expect(db).toBeDefined();
      const modelNames = ['User', 'Beneficiary', 'Shop', 'Warehouse', 'Transaction', 'Block', 'Validator'];
      
      modelNames.forEach(name => {
        expect(db[name]).toBeDefined();
        const rawAttributes = db[name].rawAttributes;
        expect(rawAttributes).toBeDefined();

        // Must have at least one primary key
        const pks = Object.keys(rawAttributes).filter(attr => rawAttributes[attr].primaryKey);
        expect(pks.length).toBeGreaterThanOrEqual(1);

        // All attributes must have defined valid Sequelize types
        Object.keys(rawAttributes).forEach(attr => {
          const type = rawAttributes[attr].type;
          expect(type).toBeDefined();
          expect(type.key).toBeDefined();
        });
      });
    });
  });
});
