/**
 * PDSChain Centralized Prometheus Metrics Registry (Phase 19)
 * 
 * Provides thread-safe, idempotent metric registration, cardinality bounding,
 * and standard Prometheus 0.0.4 text formatting across all system domains.
 */

class Metric {
  constructor(name, help, type, labelNames = []) {
    this.name = name;
    this.help = help;
    this.type = type; // 'counter' | 'gauge' | 'histogram'
    this.labelNames = labelNames;
    this.values = new Map(); // labelKey -> value
  }

  formatLabelKey(labels = {}) {
    if (this.labelNames.length === 0) return '';
    return this.labelNames
      .map(k => {
        let val = labels[k] !== undefined ? String(labels[k]) : 'unknown';
        // Bound length and sanitize special characters
        val = val.slice(0, 64).replace(/["\\\n\r]/g, '_');
        return `${k}="${val}"`;
      })
      .join(',');
  }
}

class Counter extends Metric {
  constructor(name, help, labelNames = []) {
    super(name, help, 'counter', labelNames);
  }

  inc(labels = {}, value = 1) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    if (value < 0) throw new Error('Counter can only increase monotonically');
    const key = this.formatLabelKey(labels);
    const curr = this.values.get(key) || 0;
    this.values.set(key, curr + value);
  }

  get(labels = {}) {
    const key = this.formatLabelKey(labels);
    return this.values.get(key) || 0;
  }

  reset() {
    this.values.clear();
  }
}

class Gauge extends Metric {
  constructor(name, help, labelNames = []) {
    super(name, help, 'gauge', labelNames);
  }

  set(labels = {}, value = 0) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const key = this.formatLabelKey(labels);
    this.values.set(key, value);
  }

  inc(labels = {}, value = 1) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const key = this.formatLabelKey(labels);
    const curr = this.values.get(key) || 0;
    this.values.set(key, curr + value);
  }

  dec(labels = {}, value = 1) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const key = this.formatLabelKey(labels);
    const curr = this.values.get(key) || 0;
    this.values.set(key, curr - value);
  }

  get(labels = {}) {
    const key = this.formatLabelKey(labels);
    return this.values.get(key) || 0;
  }

  reset() {
    this.values.clear();
  }
}

class Histogram extends Metric {
  constructor(name, help, labelNames = [], buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    super(name, help, 'histogram', labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.data = new Map(); // labelKey -> { count, sum, bucketCounts: Map(bucket -> count) }
  }

  observe(labels = {}, value = 0) {
    if (typeof labels === 'number') {
      value = labels;
      labels = {};
    }
    const key = this.formatLabelKey(labels);
    let record = this.data.get(key);
    if (!record) {
      record = {
        count: 0,
        sum: 0,
        bucketCounts: new Map(this.buckets.map(b => [b, 0]))
      };
      this.data.set(key, record);
    }

    record.count++;
    record.sum += value;

    for (const b of this.buckets) {
      if (value <= b) {
        record.bucketCounts.set(b, record.bucketCounts.get(b) + 1);
      }
    }
  }

  get(labels = {}) {
    const key = this.formatLabelKey(labels);
    return this.data.get(key) || { count: 0, sum: 0, bucketCounts: new Map() };
  }

  reset() {
    this.data.clear();
  }
}

class MetricsRegistry {
  constructor() {
    this.metrics = new Map();
    this.externalCollectors = [];
  }

  /**
   * Register a Counter metric idempotently
   * @param {string} name 
   * @param {string} help 
   * @param {Array<string>} [labelNames=[]] 
   * @returns {Counter}
   */
  registerCounter(name, help, labelNames = []) {
    if (this.metrics.has(name)) {
      const existing = this.metrics.get(name);
      if (existing instanceof Counter) return existing;
    }
    const metric = new Counter(name, help, labelNames);
    this.metrics.set(name, metric);
    return metric;
  }

  /**
   * Register a Gauge metric idempotently
   * @param {string} name 
   * @param {string} help 
   * @param {Array<string>} [labelNames=[]] 
   * @returns {Gauge}
   */
  registerGauge(name, help, labelNames = []) {
    if (this.metrics.has(name)) {
      const existing = this.metrics.get(name);
      if (existing instanceof Gauge) return existing;
    }
    const metric = new Gauge(name, help, labelNames);
    this.metrics.set(name, metric);
    return metric;
  }

  /**
   * Register a Histogram metric idempotently
   * @param {string} name 
   * @param {string} help 
   * @param {Array<string>} [labelNames=[]] 
   * @param {Array<number>} [buckets] 
   * @returns {Histogram}
   */
  registerHistogram(name, help, labelNames = [], buckets) {
    if (this.metrics.has(name)) {
      const existing = this.metrics.get(name);
      if (existing instanceof Histogram) return existing;
    }
    const metric = new Histogram(name, help, labelNames, buckets);
    this.metrics.set(name, metric);
    return metric;
  }

  /**
   * Register external collector producing Prometheus text (e.g. DatabaseMetrics, SecurityMetrics)
   * @param {object} collector - object with exportPrometheusMetrics() or toPrometheusFormat()
   */
  registerExternalCollector(collector) {
    if (collector && !this.externalCollectors.includes(collector)) {
      this.externalCollectors.push(collector);
    }
  }

  /**
   * Retrieve metric by name
   * @param {string} name 
   * @returns {Metric|undefined}
   */
  getMetric(name) {
    return this.metrics.get(name);
  }

  /**
   * Reset all metric values
   */
  reset() {
    for (const m of this.metrics.values()) {
      m.reset();
    }
  }

  /**
   * Clear all registered metrics
   */
  clear() {
    this.metrics.clear();
    this.externalCollectors = [];
  }

  /**
   * Export all metrics in standard Prometheus text format
   * @returns {string}
   */
  exportPrometheusText() {
    const lines = [];

    // 1. Export internal registered metrics
    for (const [name, metric] of this.metrics.entries()) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      if (metric instanceof Counter || metric instanceof Gauge) {
        if (metric.values.size === 0) {
          lines.push(`${name} 0`);
        } else {
          for (const [labelStr, val] of metric.values.entries()) {
            const labelSection = labelStr ? `{${labelStr}}` : '';
            lines.push(`${name}${labelSection} ${val}`);
          }
        }
      } else if (metric instanceof Histogram) {
        if (metric.data.size === 0) {
          lines.push(`${name}_count 0`);
          lines.push(`${name}_sum 0`);
        } else {
          for (const [labelStr, record] of metric.data.entries()) {
            const baseLabels = labelStr ? `${labelStr},` : '';
            for (const [b, count] of record.bucketCounts.entries()) {
              lines.push(`${name}_bucket{${baseLabels}le="${b}"} ${count}`);
            }
            lines.push(`${name}_bucket{${baseLabels}le="+Inf"} ${record.count}`);
            lines.push(`${name}_sum{${labelStr}} ${record.sum}`);
            lines.push(`${name}_count{${labelStr}} ${record.count}`);
          }
        }
      }
      lines.push('');
    }

    // 2. Export attached external collectors
    for (const col of this.externalCollectors) {
      if (typeof col.exportPrometheusMetrics === 'function') {
        lines.push(col.exportPrometheusMetrics().trim());
        lines.push('');
      } else if (typeof col.toPrometheusFormat === 'function') {
        lines.push(col.toPrometheusFormat().trim());
        lines.push('');
      }
    }

    return lines.join('\n').trim() + '\n';
  }

  /**
   * Export JSON snapshot of all registered metrics
   * @returns {object}
   */
  getMetricsSnapshot() {
    const snapshot = {};
    for (const [name, metric] of this.metrics.entries()) {
      if (metric instanceof Counter || metric instanceof Gauge) {
        snapshot[name] = Object.fromEntries(metric.values);
      } else if (metric instanceof Histogram) {
        const hData = {};
        for (const [lbl, rec] of metric.data.entries()) {
          hData[lbl] = {
            count: rec.count,
            sum: rec.sum,
            buckets: Object.fromEntries(rec.bucketCounts)
          };
        }
        snapshot[name] = hData;
      }
    }
    return snapshot;
  }
}

const defaultMetricsRegistry = new MetricsRegistry();

module.exports = {
  Counter,
  Gauge,
  Histogram,
  MetricsRegistry,
  defaultMetricsRegistry
};

