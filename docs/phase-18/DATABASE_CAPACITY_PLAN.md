# Phase 18: Database Capacity Planning & Sizing

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 18 — Production Database Architecture  
**Document**: Capacity Planning & Performance Sizing  
**Date**: September 17, 2026  
**Status**: APPROVED  

---

## 1. Data Sizing & Storage Growth Projections

### 1.1 Per-Record Sizing
- **Block Record**: $\approx 1.2$ KB (Header, roots, certificates, proposer signature)
- **Transaction Record**: $\approx 450$ Bytes (Ed25519 signature, commodity details, hashes)
- **Execution Receipt**: $\approx 350$ Bytes (Logs, cumulative gas, status)
- **Audit Record**: $\approx 300$ Bytes (SHA-256 hash-chain, timestamp, payload)

### 1.2 Monthly Growth Projections (100,000 Transactions / Day)
| Component | Daily Volume | Daily Storage | Monthly Storage | Annual Storage |
| :--- | :--- | :--- | :--- | :--- |
| **Blocks (5s block time)** | 17,280 blocks | $\approx 20.7$ MB | $\approx 621$ MB | $\approx 7.4$ GB |
| **Transactions** | 100,000 txs | $\approx 45$ MB | $\approx 1.35$ GB | $\approx 16.2$ GB |
| **Receipts** | 100,000 receipts | $\approx 35$ MB | $\approx 1.05$ GB | $\approx 12.6$ GB |
| **Security Audit Records** | 20,000 events | $\approx 6$ MB | $\approx 180$ MB | $\approx 2.16$ GB |
| **Total Primary Ledger** | — | **$\approx 106.7$ MB / day** | **$\approx 3.2$ GB / mo** | **$\approx 38.4$ GB / yr** |

---

## 2. Hardware Sizing & Recommended Provisioning

| Deployment Tier | CPU Cores | Memory (RAM) | Storage (NVMe SSD) | Network |
| :--- | :--- | :--- | :--- | :--- |
| **Validator Node (Local SQLite WAL)** | 4–8 vCPUs | 16 GB | 250 GB (High IOPS) | 1 Gbps |
| **Consortium Explorer / Gateway** | 8–16 vCPUs | 32 GB | 1 TB (RAID 10) | 10 Gbps |
| **Light Client / Edge Node** | 2 vCPUs | 4 GB | 20 GB | 100 Mbps |

---

## 3. Performance Targets & SLA Boundaries

- **Block Finalization Commit Latency**: $< 25$ ms (SQLite WAL mode)
- **Point Transaction Lookup**: $< 2$ ms (indexed by `transactionId` or `hash`)
- **Block Lookup by Number or Hash**: $< 1$ ms
- **Merkle Proof Lookup & Verification**: $< 3$ ms
- **Snapshot Backup Duration (100,000 Blocks)**: $< 15$ seconds

