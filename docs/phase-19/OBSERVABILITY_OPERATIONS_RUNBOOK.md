# Phase 19: Observability Operations Runbook

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage N — Operational Runbooks  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This runbook provides Day-2 operational procedures for site reliability engineers (SREs), system administrators, and validator operators managing the PDSChain observability and monitoring platform.

---

## 1. Routine Health & Telemetry Verification

### 1. Verification of Health Probes
```bash
# 1. Check process liveness (should return 200 with status: LIVE)
curl -s -i http://localhost:3000/health/live

# 2. Check traffic readiness (should return 200 with status: READY)
curl -s -i http://localhost:3000/health/ready

# 3. Check startup status (should return 200 with status: STARTED)
curl -s -i http://localhost:3000/health/startup

# 4. Check observability pipeline health (should return 200 with status: HEALTHY)
curl -s -i http://localhost:3000/health/observability

# 5. Check database subsystem (should return 200 with status: UP)
curl -s -i http://localhost:3000/health/database
```

### 2. Prometheus Scrape Verification
```bash
# Verify metrics format and scrape output
curl -s http://localhost:3000/metrics | head -n 30

# Verify metric lines contain valid HELP, TYPE, and numeric series
curl -s http://localhost:3000/api/v1/observability/metrics | grep "pds_http_requests_total"
curl -s http://localhost:3000/api/v1/observability/metrics | grep "pds_blockchain_block_height"
```

---

## 2. Redaction & Privacy Auditing

To verify that the multi-layer secret redaction filter is functioning as expected:

1. **Simulate Inbound Sensitive Log Verification**:
   Execute the automated redaction test:
   ```bash
   npm test -- tests/observability-logger-redaction.test.js
   ```
2. **Log File Inspection**:
   Inspect recent JSON logs for any unredacted patterns:
   ```bash
   grep -E "BEGIN RSA PRIVATE KEY|privateKey.*[0-9a-fA-F]{64}|password.*[^REDACTED]" /var/log/pdschain/*.log
   ```
   *Expected Result*: Zero matches. All secrets must appear strictly as `[REDACTED]` or `[REDACTED_SECRET]`.

---

## 3. Log Rotation & Disk Management

### Production Logrotate Configuration (`/etc/logrotate.d/pdschain`)
```
/var/log/pdschain/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 pdschain pdschain
    sharedscripts
    postrotate
        /usr/bin/killall -HUP node 2>/dev/null || true
    endscript
}
```

---

## 4. Tracing & Exporter Troubleshooting

If distributed trace spans fail to appear in the tracing backend:
1. Verify `TRACING_ENABLED=true` in the node environment.
2. Verify `TRACING_EXPORTER` is set to `otlp` and `TRACING_ENDPOINT` is reachable.
3. Check `pds_observability_dropped_spans_total` to determine if spans are being dropped due to network timeouts.
4. Verify W3C `traceparent` headers are arriving at the ingress proxy without header stripping.

