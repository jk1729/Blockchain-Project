# Phase 19: Observability Configuration Reference

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage L — Configuration and Deployment  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document details all configuration parameters, environment variables, and deployment conventions for PDSChain's observability platform. All configuration defaults are production-safe and fail closed.

---

## 1. Environment Variable Reference

| Variable | Description | Allowed Values | Production Default | Dev/Test Default |
| :--- | :--- | :--- | :--- | :--- |
| `SERVICE_NAME` | Service identifier for logs and traces | Alphanumeric string | `pdschain-backend` | `pdschain-backend` |
| `NODE_ENV` | Runtime environment name | `development`, `production`, `test` | `production` | `development` |
| `LOG_LEVEL` | Minimum log severity to emit | `debug`, `info`, `warn`, `error`, `fatal` | `info` | `debug` / `warn` |
| `LOG_FORMAT` | Log serialization format | `json`, `text` | `json` | `text` |
| `LOG_STACK_TRACES` | Include stack traces on error logs | `true`, `false` | `false` | `true` |
| `METRICS_ENABLED` | Enable internal Prometheus metrics collection | `true`, `false` | `true` | `true` |
| `METRICS_PATH` | Path for Prometheus metrics scraper | Valid URL path | `/api/v1/observability/metrics` | Same |
| `TRACING_ENABLED` | Enable distributed span tracing | `true`, `false` | `true` | `true` |
| `TRACING_EXPORTER`| Destination for completed trace spans | `none`, `console`, `memory`, `otlp` | `none` / `otlp` | `none` / `memory` |
| `TRACING_SAMPLE_RATE` | Head-based sampling probability | Float between `0.0` and `1.0` | `0.1` (10%) | `1.0` (100%) |
| `HEALTH_TIMEOUT_MS` | Timeout for health check dependency probes | Integer (ms) | `2500` | `2500` |

---

## 2. Docker & Kubernetes Deployment Integration

### Kubernetes Pod Spec Annotations
```yaml
metadata:
  annotations:
    prometheus.io/scrape: "true"
    prometheus.io/path: "/api/v1/observability/metrics"
    prometheus.io/port: "3000"
```

### Container Probe Definitions
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health/startup
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 30
```

