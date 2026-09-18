/**
 * Phase 19: Centralized Prometheus Metrics Registry Test Suite
 */

const { MetricsRegistry, Counter, Gauge, Histogram } = require('../src/observability/MetricsRegistry');

describe('Phase 19: Centralized Prometheus Metrics Registry', () => {
  let registry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  describe('1. Idempotent Registration & Metric Types', () => {
    test('registerCounter should be idempotent and return existing counter instance', () => {
      const c1 = registry.registerCounter('test_counter_total', 'Test counter', ['service']);
      const c2 = registry.registerCounter('test_counter_total', 'Test counter', ['service']);
      expect(c1).toBe(c2);
      expect(c1 instanceof Counter).toBe(true);
    });

    test('registerGauge should be idempotent and return existing gauge instance', () => {
      const g1 = registry.registerGauge('test_gauge', 'Test gauge');
      const g2 = registry.registerGauge('test_gauge', 'Test gauge');
      expect(g1).toBe(g2);
      expect(g1 instanceof Gauge).toBe(true);
    });

    test('registerHistogram should configure sorted buckets correctly', () => {
      const h1 = registry.registerHistogram('test_duration_seconds', 'Duration', ['route'], [0.1, 0.05, 0.5]);
      expect(h1 instanceof Histogram).toBe(true);
      expect(h1.buckets).toEqual([0.05, 0.1, 0.5]);
    });
  });

  describe('2. Metrics Operations & Label Cardinality Bounds', () => {
    test('Counter should increase monotonically and reject negative values', () => {
      const counter = registry.registerCounter('pds_commits_total', 'Total commits', ['status']);
      counter.inc({ status: 'success' }, 5);
      counter.inc({ status: 'success' }, 2);

      expect(counter.get({ status: 'success' })).toBe(7);
      expect(() => counter.inc({ status: 'success' }, -1)).toThrow('Counter can only increase monotonically');
    });

    test('Gauge should support set, inc, and dec correctly', () => {
      const gauge = registry.registerGauge('pds_active_conns', 'Active connections');
      gauge.set(10);
      expect(gauge.get()).toBe(10);
      gauge.inc(2);
      expect(gauge.get()).toBe(12);
      gauge.dec(5);
      expect(gauge.get()).toBe(7);
    });

    test('Histogram should distribute observations into correct buckets', () => {
      const h = registry.registerHistogram('pds_latencies', 'Latencies', [], [0.1, 0.5, 1.0]);
      h.observe(0.04);
      h.observe(0.2);
      h.observe(0.8);

      const res = h.get();
      expect(res.count).toBe(3);
      expect(res.sum).toBeCloseTo(1.04, 2);
      expect(res.bucketCounts.get(0.1)).toBe(1); // 0.04
      expect(res.bucketCounts.get(0.5)).toBe(2); // 0.04, 0.2
      expect(res.bucketCounts.get(1.0)).toBe(3); // 0.04, 0.2, 0.8
    });

    test('should bound label values and sanitize special characters', () => {
      const counter = registry.registerCounter('pds_labeled_total', 'Labeled', ['dim']);
      const dangerousLabel = 'value_with_"quotes"_and_\n_newlines_' + 'x'.repeat(100);
      counter.inc({ dim: dangerousLabel }, 1);

      const text = registry.exportPrometheusText();
      expect(text).not.toContain('\n_newlines_');
      expect(text).toContain('pds_labeled_total{dim="');
    });
  });

  describe('3. Prometheus Text Formatting & External Collectors', () => {
    test('exportPrometheusText should render compliant Prometheus representation', () => {
      const c = registry.registerCounter('pds_runs_total', 'Total runs', ['env']);
      c.inc({ env: 'prod' }, 42);

      const text = registry.exportPrometheusText();
      expect(text).toContain('# HELP pds_runs_total Total runs');
      expect(text).toContain('# TYPE pds_runs_total counter');
      expect(text).toContain('pds_runs_total{env="prod"} 42');
    });

    test('should append external collectors into central scrape text', () => {
      const mockCollector = {
        exportPrometheusMetrics: () => '# HELP mock_metric\n# TYPE mock_metric counter\nmock_metric 100\n'
      };

      registry.registerExternalCollector(mockCollector);
      const text = registry.exportPrometheusText();
      expect(text).toContain('mock_metric 100');
    });
  });
});

