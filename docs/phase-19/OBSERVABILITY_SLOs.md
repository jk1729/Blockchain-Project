# Phase 19: Service-Level Objectives (SLOs) & Error Budgets

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 19 — Production Observability and Monitoring  
**Stage**: Stage H — SLOs and Service-Level Indicators  
**Date**: September 18, 2026  
**Status**: COMPLETE  

---

## Executive Summary

This document establishes the production Service-Level Indicators (SLIs), Service-Level Objectives (SLOs), and Error Budgets for PDSChain. These metrics govern operational reliability, deployment safety, and automated incident escalation.

---

## 1. Canonical SLI & SLO Inventory

| SLI Name | Objective / Description | Target | Window | Error Budget | Alert Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API Availability** | Successful HTTP 2xx/3xx responses over total non-4xx requests | **99.9%** | 30 Days | 0.1% (43.2 min downtime/mo) | 5xx rate > 0.1% for 5m |
| **API Latency** | Percentage of HTTP requests completed in under 200ms | **95.0%** | 30 Days | 5.0% | p95 latency > 200ms for 5m |
| **JSON-RPC Availability** | Successful RPC responses without internal server errors (-32603) | **99.9%** | 30 Days | 0.1% | RPC error rate > 0.1% for 5m |
| **JSON-RPC Latency** | Percentage of JSON-RPC requests completed in under 150ms | **95.0%** | 30 Days | 5.0% | p95 RPC latency > 150ms for 5m |
| **Block Finalization** | Finalized blocks successfully committed without consensus split | **99.99%** | 30 Days | 0.01% | Block height halted for > 15s |
| **Consensus Round Success** | Proposed consensus rounds finalizing without timeout/restart | **99.5%** | 30 Days | 0.5% | > 2 consecutive round timeouts |
| **Transaction Execution** | Valid transactions executed on-chain without unexpected engine panic | **99.9%** | 30 Days | 0.1% | System execution failures > 0.1% |
| **Database Availability** | Successful database queries without connection timeout or pool exhaustion | **99.95%** | 30 Days | 0.05% | Pool exhaustion / down > 1m |
| **Database Tx Success** | Finalized atomic database transactions committed without rollback | **99.99%** | 30 Days | 0.01% | Rollbacks > 0.01% on finalization |
| **Sync Freshness** | Validator block height lag maintained at <= 2 blocks from consortium tip | **99.0%** | 30 Days | 1.0% | Replica lag > 5 blocks for 2m |
| **Security Audit Logging** | Audit log journal write and hash-chaining operations without failure | **100.0%** | 30 Days | 0.0% | ANY journal append failure (Page) |

---

## 2. Error Budget Calculations & Policies

### 1. Error Budget Formula
$$\text{Error Budget} = 100\% - \text{SLO Target}$$
$$\text{Budget Consumed} = \frac{100\% - \text{Measured SLI}}{\text{Error Budget}} \times 100\%$$

### 2. Burn Rate & Policy Gates
- **Burn Rate 1x**: Normal rate consuming 100% of budget over 30 days. Action: Normal operation.
- **Burn Rate 2x–5x**: Consuming budget in 6–15 days. Action: File high-priority Jira ticket; investigate in next sprint.
- **Burn Rate 14.4x (2% consumed in 1 hour)**: Action: Page on-call engineer; freeze non-critical deployments.
- **Burn Rate 36x (5% consumed in 1 hour)**: Action: Page on-call; initiate emergency incident response and deploy hotfix.
- **Exhausted Budget (<0% remaining)**: Production feature freeze. All engineering effort pivots to reliability, testing, and performance optimization until budget recovers.

