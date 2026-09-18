const fs = require('fs');
const path = require('path');
const { ValidatorConfig, ConfigurationError } = require('../src/config/validatorConfig');

describe('PHASE 11: Production Configuration System Test Suite', () => {
  const tmpDir = path.resolve(__dirname, 'tmp-config-test');

  beforeAll(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('1. Construction & Default Behavior', () => {
    it('1.1 should construct a valid config for VAL-01 using defaults', () => {
      const config = ValidatorConfig.forValidator('VAL-01');
      expect(config.validatorId).toBe('VAL-01');
      expect(config.apiPort).toBe(4001);
      expect(config.listenPort).toBe(5001);
      expect(config.peers.length).toBe(11);
      expect(config.validate()).toBe(true);
    });

    it('1.2 should correctly reflect override values', () => {
      const config = ValidatorConfig.forValidator('VAL-02', {
        apiPort: 8080,
        listenPort: 9090,
        networkId: 'custom-network'
      });
      expect(config.apiPort).toBe(8080);
      expect(config.listenPort).toBe(9090);
      expect(config.networkId).toBe('custom-network');
      expect(config.validate()).toBe(true);
    });
  });

  describe('2. Validation & Boundary Enforcement', () => {
    it('2.1 should reject missing validatorId', () => {
      const config = new ValidatorConfig({ validatorId: '' });
      expect(() => config.validate()).toThrow(ConfigurationError);
      expect(() => config.validate()).toThrow(/validatorId is required/);
    });

    it('2.2 should reject invalid validatorId format', () => {
      const config = new ValidatorConfig({ validatorId: 'MALICIOUS-NODE' });
      expect(() => config.validate()).toThrow(ConfigurationError);
      expect(() => config.validate()).toThrow(/Invalid validatorId format/);
    });

    it('2.3 should reject invalid port ranges', () => {
      const config1 = ValidatorConfig.forValidator('VAL-01', { apiPort: 0 });
      expect(() => config1.validate()).toThrow(/Invalid HTTP apiPort/);

      const config2 = ValidatorConfig.forValidator('VAL-01', { listenPort: 70000 });
      expect(() => config2.validate()).toThrow(/Invalid P2P listenPort/);
    });

    it('2.4 should reject identical apiPort and listenPort (port collision)', () => {
      const config = ValidatorConfig.forValidator('VAL-01', { apiPort: 5001, listenPort: 5001 });
      expect(() => config.validate()).toThrow(/cannot be identical/);
    });

    it('2.5 should reject self in peer list', () => {
      const config = new ValidatorConfig({
        validatorId: 'VAL-01',
        apiPort: 4001,
        listenPort: 5001,
        peers: [{ validatorId: 'VAL-01', host: '127.0.0.1', port: 5001 }]
      });
      expect(() => config.validate()).toThrow(/Cannot configure self/);
    });

    it('2.6 should reject duplicate peers in peer list', () => {
      const config = new ValidatorConfig({
        validatorId: 'VAL-01',
        apiPort: 4001,
        listenPort: 5001,
        peers: [
          { validatorId: 'VAL-02', host: '127.0.0.1', port: 5002 },
          { validatorId: 'VAL-02', host: '127.0.0.1', port: 5002 }
        ]
      });
      expect(() => config.validate()).toThrow(/Duplicate peer/);
    });
  });

  describe('3. Production Mode Enforcement', () => {
    it('3.1 should reject development networkId in production mode', () => {
      const config = ValidatorConfig.forValidator('VAL-01', {
        nodeEnv: 'production',
        networkId: 'pdschain-devnet'
      });
      expect(() => config.validate()).toThrow(/Production mode cannot use development networkId/);
    });

    it('3.2 should pass validation in production mode with valid production parameters', () => {
      const config = ValidatorConfig.forValidator('VAL-01', {
        nodeEnv: 'production',
        networkId: 'pdschain-mainnet',
        identityPath: path.join(tmpDir, 'identity.json')
      });
      expect(config.validate()).toBe(true);
    });
  });

  describe('4. File Loading & Sanitized Export', () => {
    it('4.1 should load configuration from a valid JSON file', () => {
      const configFile = path.join(tmpDir, 'val-test.json');
      const fileContent = {
        validatorId: 'VAL-03',
        apiPort: 4103,
        listenPort: 5103,
        networkId: 'pdschain-testnet',
        chainId: 1729
      };
      fs.writeFileSync(configFile, JSON.stringify(fileContent, null, 2));

      const loaded = ValidatorConfig.fromFile(configFile);
      expect(loaded.validatorId).toBe('VAL-03');
      expect(loaded.apiPort).toBe(4103);
      expect(loaded.listenPort).toBe(5103);
      expect(loaded.validate()).toBe(true);
    });

    it('4.2 toSafeObject should return non-sensitive diagnostics with no private keys', () => {
      const config = ValidatorConfig.forValidator('VAL-01');
      const safe = config.toSafeObject();

      expect(safe.validatorId).toBe('VAL-01');
      expect(safe.privateKey).toBeUndefined();
      expect(safe.secret).toBeUndefined();
      expect(safe.password).toBeUndefined();
      expect(typeof safe.apiPort).toBe('number');
      expect(typeof safe.listenPort).toBe('number');
    });
  });
});

