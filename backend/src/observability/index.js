/**
 * PDSChain Observability Subsystem Aggregator (Phase 19)
 */

const RequestContext = require('./RequestContext');
const { StructuredLogger, defaultStructuredLogger, LOG_LEVELS } = require('./StructuredLogger');
const { MetricsRegistry, defaultMetricsRegistry, Counter, Gauge, Histogram } = require('./MetricsRegistry');
const { ApplicationMetrics, defaultApplicationMetrics } = require('./ApplicationMetrics');
const { ConsensusMetrics, defaultConsensusMetrics } = require('./ConsensusMetrics');
const { RuntimeMetrics, defaultRuntimeMetrics } = require('./RuntimeMetrics');
const { Span, SPAN_STATUS } = require('./Span');
const { Tracer, defaultTracer } = require('./Tracer');
const { HealthManager, defaultHealthManager } = require('./HealthManager');
const { SloEngine, defaultSloEngine, DEFAULT_SLOS } = require('./SloEngine');
const { AlertManager, defaultAlertManager, ALERT_RULES } = require('./AlertManager');
const { ObservabilityConfig, defaultObservabilityConfig } = require('./ObservabilityConfig');

// Attach Phase 18 and Phase 17 metrics collectors to centralized registry
try {
  const { defaultDatabaseMetrics } = require('../database/DatabaseMetrics');
  defaultMetricsRegistry.registerExternalCollector(defaultDatabaseMetrics);
} catch (_) {}

try {
  const { defaultSecurityMetrics } = require('../security/permissions/SecurityMetrics');
  defaultMetricsRegistry.registerExternalCollector(defaultSecurityMetrics);
} catch (_) {}

module.exports = {
  RequestContext,
  StructuredLogger,
  defaultStructuredLogger,
  LOG_LEVELS,
  MetricsRegistry,
  defaultMetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  ApplicationMetrics,
  defaultApplicationMetrics,
  ConsensusMetrics,
  defaultConsensusMetrics,
  RuntimeMetrics,
  defaultRuntimeMetrics,
  Span,
  SPAN_STATUS,
  Tracer,
  defaultTracer,
  HealthManager,
  defaultHealthManager,
  SloEngine,
  defaultSloEngine,
  DEFAULT_SLOS,
  AlertManager,
  defaultAlertManager,
  ALERT_RULES,
  ObservabilityConfig,
  defaultObservabilityConfig
};

