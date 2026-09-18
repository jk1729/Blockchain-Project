# Phase 21: Production Capacity Planning Model

**Document Reference:** `docs/phase-21/CAPACITY_PLANNING_MODEL.md`  
**Phase:** 21 — Performance and Load Testing  
**Status:** Approved & Implemented  
**Date:** September 2026  

---

## 1. Scale Targets & Workload Sizing

PDSChain is designed to support the operational demands of India's Public Distribution System across state-level and nationwide deployments:
- **Fair Price Shops (FPS)**: ~500,000 active distribution centers.
- **Daily Beneficiaries**: ~10,000,000 grain transactions per day during peak distribution windows (first 10 days of each calendar month).
- **Nominal Operating Window**: 8 operating hours daily (09:00 - 17:00 IST) = 28,800 seconds.
- **Required Throughput**:
  - Nominal Steady-State: $\frac{10,000,000}{28,800} \approx \mathbf{347\text{ TPS}}$
  - Peak Distribution Burst (2.0x factor): $\approx \mathbf{700\text{ TPS}}$
  - In-State Regional Cluster (e.g. 1/10th of national volume): $\approx \mathbf{35\text{ to }70\text{ TPS}}$

---

## 2. Validator Hardware & Node Sizing Recommendations

| Cluster Scale | Target TPS | Validator Count | Minimum CPU | Minimum RAM | Storage Type | Recommended Headroom |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Dev / Staging** | 50 - 100 TPS | 4 Nodes | 2 vCPU | 4 GB | Local SSD | 50% |
| **Regional State Cluster**| 100 - 250 TPS | 4 - 8 Nodes | 4 vCPU | 8 GB | NVMe SSD | 60% |
| **High-Volume Production**| 500 - 1,000 TPS | 8 - 16 Nodes | 8 vCPU | 16 GB | Provisioned IOPS NVMe | 75% |

---

## 3. Storage Growth Projections

- **Transaction Payload Size**: ~512 bytes (signatures, beneficiary hash, commodity tokens).
- **Block Header & Merkle Proofs**: ~1 KB per block.
- **Daily Ledger Growth (at 10M transactions/day)**:
  $$\text{Payload} \approx 10,000,000 \times 512\text{ bytes} \approx 5.12\text{ GB / day}$$
  $$\text{Indexes \& WAL} \approx 2.5\text{ GB / day}$$
  $$\text{Total Daily Storage Growth} \approx \mathbf{7.6\text{ GB / day}}$$
  $$\text{Annual Storage Requirement} \approx \mathbf{2.77\text{ TB / year}}$$
- **Retention Strategy**: Full archive nodes retain complete block history; validator consensus nodes prune historical state roots older than 90 days, relying on cryptographic Merkle commitments.

