/**
 * PDSChain Observability Configuration (Phase 19)
 * 
 * Validates and exposes sanitized configuration for logging, metrics, tracing,
 * health probes, and runtime sampling.
 */

class ObservabilityConfig {
  constructor(env = process.env) {
    this.serviceName = env.SERVICE_NAME || 'pdschain-backend';
    this.environment = env.NODE_ENV || 'development';
    
    // Logging config
    const validLogLevels = ['debug', 'info', 'warn', 'error', 'fatal'];
    const rawLogLevel = (env.LOG_LEVEL || (this.environment === 'test' ? 'warn' : 'info')).toLowerCase();
    this.logLevel = validLogLevels.includes(rawLogLevel) ? rawLogLevel : 'info';
    this.logFormat = env.LOG_FORMAT || (this.environment === 'production' ? 'json' : 'text');
    this.logStackTraces = env.LOG_STACK_TRACES === 'true' || this.environment !== 'production';

    // Metrics config
    this.metricsEnabled = env.METRICS_ENABLED !== 'false';
    this.metricsPath = env.METRICS_PATH || '/api/v1/observability/metrics';

    // Tracing config
    this.tracingEnabled = env.TRACING_ENABLED === 'true' || this.environment === 'test';
    const validExporters = ['none', 'console', 'memory', 'otlp'];
    const rawExporter = (env.TRACING_EXPORTER || 'none').toLowerCase();
    this.tracingExporter = validExporters.includes(rawExporter) ? rawExporter : 'none';
    
    const parsedSample = parseFloat(env.TRACING_SAMPLE_RATE);
    this.tracingSampleRate = (!isNaN(parsedSample) && parsedSample >= 0 && parsedSample <= 1.0)
      ? parsedSample
      : (this.environment === 'production' ? 0.1 : 1.0);

    // Health config
    this.healthTimeoutMs = parseInt(env.HEALTH_TIMEOUT_MS, 10) || 2500;
  }

  /**
   * Return non-sensitive configuration diagnostics
   * @returns {object}
   */
  getSanitized() {
    return {
      serviceName: this.serviceName,
      environment: this.environment,
      logging: {
        level: this.logLevel,
        format: this.logFormat,
        stackTraces: this.logStackTraces
      },
      metrics: {
        enabled: this.metricsEnabled,
        path: this.metricsPath
      },
      tracing: {
        enabled: this.tracingEnabled,
        exporter: this.tracingExporter,
        sampleRate: this.tracingSampleRate
      },
      health: {
        timeoutMs: this.healthTimeoutMs
      }
    };
  }
}

const defaultObservabilityConfig = new ObservabilityConfig();

module.exports = {
  ObservabilityConfig,
  defaultObservabilityConfig
};

