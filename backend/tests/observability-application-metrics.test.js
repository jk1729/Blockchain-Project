/**
 * Phase 19: Application, HTTP, and RPC Metrics Test Suite
 */

const { ApplicationMetrics } = require('../src/observability/ApplicationMetrics');
const { MetricsRegistry } = require('../src/observability/MetricsRegistry');

describe('Phase 19: Application & HTTP/RPC Metrics', () => {
  let registry;
  let appMetrics;

  beforeEach(() => {
    registry = new MetricsRegistry();
    appMetrics = new ApplicationMetrics(registry);
  });

  describe('1. Route Normalization & Cardinality Defense', () => {
    test('should normalize dynamic block numbers and heights into :height token', () => {
      expect(ApplicationMetrics.normalizeRoute('/api/v1/blocks/1054')).toBe('/api/v1/blocks/:height');
      expect(ApplicationMetrics.normalizeRoute('/blocks/999999')).toBe('/blocks/:height');
    });

    test('should normalize transaction and block hex hashes into :hash token', () => {
      const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      expect(ApplicationMetrics.normalizeRoute(`/api/v1/transactions/${hash}`)).toBe('/api/v1/transactions/:hash');
    });

    test('should normalize entity IDs (beneficiaries, shops, warehouses, validators)', () => {
      expect(ApplicationMetrics.normalizeRoute('/api/v1/beneficiaries/BEN-001')).toBe('/api/v1/beneficiaries/:id');
      expect(ApplicationMetrics.normalizeRoute('/api/v1/shops/SHOP-12')).toBe('/api/v1/shops/:id');
      expect(ApplicationMetrics.normalizeRoute('/api/v1/warehouses/WH-03')).toBe('/api/v1/warehouses/:id');
    });
  });

  describe('2. HTTP Request Telemetry', () => {
    test('recordHttpRequest should increment requests and observe latency histogram', () => {
      appMetrics.recordHttpRequest('GET', '/api/v1/blockchain', 200, 0.045, 1024);
      appMetrics.recordHttpRequest('GET', '/api/v1/blockchain', 200, 0.085, 2048);

      const reqCount = appMetrics.httpRequestsTotal.get({
        method: 'GET',
        route: '/api/v1/blockchain',
        status_code: '200'
      });
      expect(reqCount).toBe(2);

      const hist = appMetrics.httpRequestDuration.get({
        method: 'GET',
        route: '/api/v1/blockchain',
        status_code: '200'
      });
      expect(hist.count).toBe(2);
      expect(hist.sum).toBeCloseTo(0.13, 2);
    });

    test('requestsInFlight gauge should increment and decrement correctly', () => {
      expect(appMetrics.requestsInFlight.get()).toBe(0);
      appMetrics.requestsInFlight.inc();
      expect(appMetrics.requestsInFlight.get()).toBe(1);
      appMetrics.requestsInFlight.dec();
      expect(appMetrics.requestsInFlight.get()).toBe(0);
    });

    test('recordHttpError should categorize errors by stable error code', () => {
      appMetrics.recordHttpError('INVALID_SIGNATURE');
      appMetrics.recordHttpError('INVALID_SIGNATURE');
      appMetrics.recordHttpError('POOL_EXHAUSTED');

      expect(appMetrics.httpErrorsTotal.get({ error_code: 'INVALID_SIGNATURE' })).toBe(2);
      expect(appMetrics.httpErrorsTotal.get({ error_code: 'POOL_EXHAUSTED' })).toBe(1);
    });
  });

  describe('3. JSON-RPC & SSE Telemetry', () => {
    test('recordRpcRequest should record method call count, duration, and error codes', () => {
      appMetrics.recordRpcRequest('pds_getBlockByNumber', 0.015);
      appMetrics.recordRpcRequest('pds_getBlockByNumber', 0.020, -32602);

      expect(appMetrics.rpcRequestsTotal.get({ method: 'pds_getBlockByNumber' })).toBe(2);
      expect(appMetrics.rpcErrorsTotal.get({ method: 'pds_getBlockByNumber', error_code: '-32602' })).toBe(1);
    });

    test('SSE metrics should record active connections, event deliveries, and drops', () => {
      appMetrics.setSseClients(5);
      expect(appMetrics.sseConnectionsActive.get()).toBe(5);

      appMetrics.recordSseDelivery('BLOCKS', 10);
      expect(appMetrics.sseEventsDeliveredTotal.get({ category: 'BLOCKS' })).toBe(10);

      appMetrics.recordSseDrop(2);
      expect(appMetrics.sseEventsDroppedTotal.get()).toBe(2);
    });
  });
});

