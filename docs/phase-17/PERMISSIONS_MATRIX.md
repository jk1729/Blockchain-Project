# Phase 17: Canonical Permissions and Role Matrix

**Project**: PDSChain — Blockchain-Based Public Distribution System  
**Phase**: Phase 17 — Security Hardening, Permissions, and Authorization  
**Date**: September 17, 2026  
**Status**: APPROVED & ENFORCED  

---

## 1. System Roles

| Role | Classification | Trust Boundary | Primary Responsibilities |
| :--- | :--- | :--- | :--- |
| **`PUBLIC_READER`** | Public | Untrusted Internet | Read-only queries for finalized blocks, transactions, receipts, events, proofs, network status, health. Zero mutations. |
| **`CLIENT`** | Application Client | Authenticated DMZ | Read own account/transaction details, subscribe to client events, execute read-only smart contract view calls. |
| **`CITIZEN`** | PDS Beneficiary | Authenticated DMZ | Scoped client access. Inspect own ration allocations and transaction receipts. |
| **`SHOP`** | FPS Merchant | Authenticated DMZ | Scoped client access. Distribute ration quotas to citizens, submit transaction proposals from assigned `shopId`. |
| **`WAREHOUSE`** | Depot Manager | Authenticated DMZ | Scoped client access. Manage warehouse stock, execute atomic stock transfers from assigned `warehouseId`. |
| **`DEVELOPER`** | API Integrator | Authenticated DMZ | Submit transactions, estimate gas, deploy and interact with smart contracts. |
| **`AUDITOR`** | Compliance Auditor | Authenticated Internal | Comprehensive read access to node status, sync telemetry, security events, certificate metadata, and audit logs. |
| **`VALIDATOR`** | Consensus Daemon | Consortium mTLS Mesh | Broadcast signed FBA proposals, votes, consensus certificates, round-change timeouts, and ledger sync requests. |
| **`VALIDATOR_OPERATOR`** | Node Operator | Local Operator | Manage validator process, trigger sync/reindex, inspect node health, reload configurations. |
| **`NODE_OPERATOR`** | Host Operator | Local Operator | Host-level daemon supervision, log level management, backup creation. |
| **`CONSORTIUM_OPERATOR`** | Federation Operator | Consortium Internal | Approve node recovery plans, restore nodes from verified backups, manage peer endpoints. |
| **`SECURITY_OPERATOR`** | PKI & Key Officer | Consortium Internal | Reload TLS certificates, rotate certificates, revoke compromised certificates (CRL), stage consensus key rotation. |
| **`RECOVERY_OPERATOR`** | Disaster Recovery | Consortium Internal | Verify checkpoints, replay write-ahead journals, repair derived state tables, halt/resume consensus engines. |
| **`ADMIN`** | PDS System Admin | Authenticated Internal | Manage users, issue API keys, manage rate limits, read audit logs, manage shops, warehouses, and beneficiaries. |
| **`API_ADMIN`** | Gateway Admin | Authenticated Internal | Issue, rotate, and revoke API access keys, manage rate-limiting policies. |
| **`SYSTEM_ADMIN`** | IT Infrastructure | Authenticated Internal | Manage roles, permissions, service accounts, export verifiable audit logs, configure network boundaries. |
| **`SUPER_ADMIN`** | Consortium Governance | Multi-Party Approval | System-wide policy administration. Barred from raw consensus private key export. |
| **`BREAK_GLASS_OPERATOR`** | Emergency Incident | Audited Time-Bound | Emergency break-glass override with logged justification reason and automatic expiration. |

---

## 2. Granular Permissions Registry

| Permission Identifier | Resource | Action | Scope | Public | Mutating | Consensus Critical | MFA | Audit |
| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `public:read:chain` | chain | read | GLOBAL | Yes | No | No | No | No |
| `public:read:block` | block | read | GLOBAL | Yes | No | No | No | No |
| `public:read:transaction` | transaction | read | GLOBAL | Yes | No | No | No | No |
| `public:read:receipt` | receipt | read | GLOBAL | Yes | No | No | No | No |
| `public:read:contract` | contract | read | GLOBAL | Yes | No | No | No | No |
| `public:read:event` | event | read | GLOBAL | Yes | No | No | No | No |
| `public:read:proof` | proof | read | GLOBAL | Yes | No | No | No | No |
| `public:read:validator-summary` | validator | read-summary | GLOBAL | Yes | No | No | No | No |
| `public:read:network-summary` | network | read-summary | GLOBAL | Yes | No | No | No | No |
| `public:read:health` | health | read | GLOBAL | Yes | No | No | No | No |
| `public:read:api-docs` | docs | read | GLOBAL | Yes | No | No | No | No |
| `client:submit:transaction` | transaction | submit | ENTITY | No | Yes | Yes | No | Yes |
| `client:read:transaction-status` | transaction | read-status | USER | No | No | No | No | No |
| `client:read:receipt` | receipt | read | GLOBAL | No | No | No | No | No |
| `client:read:event` | event | read | GLOBAL | No | No | No | No | No |
| `client:read:proof` | proof | read | GLOBAL | No | No | No | No | No |
| `client:execute:readonly-call` | contract | call | GLOBAL | No | No | No | No | No |
| `client:estimate:gas` | contract | estimate-gas | GLOBAL | No | No | No | No | No |
| `client:subscribe:event` | event | subscribe | GLOBAL | No | No | No | No | No |
| `client:read:account` | account | read | USER | No | No | No | No | No |
| `validator:authenticate:peer` | peer | authenticate | VALIDATOR | No | No | Yes | No | Yes |
| `validator:read:peer-status` | peer | read-status | VALIDATOR | No | No | No | No | No |
| `validator:send:proposal` | consensus | send-proposal | VALIDATOR | No | Yes | Yes | No | Yes |
| `validator:send:vote` | consensus | send-vote | VALIDATOR | No | Yes | Yes | No | Yes |
| `validator:send:certificate` | consensus | send-cert | VALIDATOR | No | Yes | Yes | No | Yes |
| `validator:send:round-change` | consensus | send-round | VALIDATOR | No | Yes | Yes | No | Yes |
| `validator:request:sync` | sync | request-sync | VALIDATOR | No | No | Yes | No | No |
| `validator:send:sync-response` | sync | send-sync | VALIDATOR | No | No | Yes | No | No |
| `validator:read:consensus-state` | consensus | read-state | VALIDATOR | No | No | No | No | No |
| `validator:read:finalized-ledger`| ledger | read-final | VALIDATOR | No | No | No | No | No |
| `validator:write:consensus-journal`| journal | write-cons | VALIDATOR | No | Yes | Yes | No | No |
| `validator:write:checkpoint` | checkpoint | write | VALIDATOR | No | Yes | Yes | No | Yes |
| `validator:participate:consensus`| consensus | participate | VALIDATOR | No | Yes | Yes | No | Yes |
| `operator:read:node-status` | node | read-status | VALIDATOR | No | No | No | No | No |
| `operator:read:network-status` | network | read-status | GLOBAL | No | No | No | No | No |
| `operator:read:sync-status` | sync | read-status | GLOBAL | No | No | No | No | No |
| `operator:read:recovery-status` | recovery | read-status | GLOBAL | No | No | No | No | No |
| `operator:read:security-events` | event | read-sec | GLOBAL | No | No | No | No | Yes |
| `operator:read:audit-events` | audit | read | GLOBAL | No | No | No | No | Yes |
| `operator:read:metrics` | metrics | read | GLOBAL | No | No | No | No | No |
| `operator:manage:validator-process`| process | manage | VALIDATOR | No | Yes | No | No | Yes |
| `operator:manage:peer` | peer | manage | GLOBAL | No | Yes | No | No | Yes |
| `operator:manage:configuration` | config | manage | GLOBAL | No | Yes | No | No | Yes |
| `operator:manage:log-level` | config | set-level | GLOBAL | No | Yes | No | No | Yes |
| `operator:trigger:reindex` | index | trigger-rebuild| GLOBAL | No | Yes | No | No | Yes |
| `operator:trigger:sync` | sync | trigger | GLOBAL | No | Yes | No | No | Yes |
| `operator:trigger:backup` | backup | create | GLOBAL | No | Yes | No | No | Yes |
| `operator:restore:node` | backup | restore | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `operator:approve:recovery` | recovery | approve | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:read:tls-status` | tls | read-status | GLOBAL | No | No | No | No | No |
| `security:read:certificate-metadata`| cert | read-meta | GLOBAL | No | No | No | No | No |
| `security:reload:certificate` | cert | reload | GLOBAL | No | Yes | No | No | Yes |
| `security:rotate:certificate` | cert | rotate | RESTRICTED | No | Yes | No | Yes | Yes |
| `security:revoke:certificate` | cert | revoke | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:manage:trust-store` | trust-store| manage | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:manage:crl` | crl | manage | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:read:key-metadata` | key | read-meta | GLOBAL | No | No | No | No | No |
| `security:load:key` | keystore | load-key | RESTRICTED | No | No | Yes | Yes | Yes |
| `security:stage:key-rotation` | key | stage-rot | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:activate:key-rotation` | key | activate-rot | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:rollback:key-rotation` | key | rollback-rot | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:revoke:identity` | identity | revoke | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:manage:peer-authorization`| peer-auth | manage | GLOBAL | No | Yes | Yes | No | Yes |
| `security:manage:keystore` | keystore | manage | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `security:destroy:key-material` | key | destroy | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `recovery:read:status` | recovery | read-status | GLOBAL | No | No | No | No | No |
| `recovery:verify:checkpoint` | checkpoint | verify | GLOBAL | No | No | No | No | Yes |
| `recovery:replay:journal` | journal | replay | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `recovery:rebuild:index` | index | rebuild | GLOBAL | No | Yes | No | No | Yes |
| `recovery:trigger:sync` | sync | trigger | GLOBAL | No | Yes | Yes | No | Yes |
| `recovery:repair:derived-state` | state | repair-derived| RESTRICTED | No | Yes | Yes | Yes | Yes |
| `recovery:rollback:nonfinalized-state`| state | rollback-nonfin| RESTRICTED| No | Yes | Yes | Yes | Yes |
| `recovery:halt:validator` | validator | halt | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `recovery:resume:validator` | validator | resume | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `recovery:restore:backup` | backup | restore | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `admin:manage:roles` | role | manage | GLOBAL | No | Yes | No | Yes | Yes |
| `admin:manage:permissions` | permission | manage | GLOBAL | No | Yes | No | Yes | Yes |
| `admin:manage:users` | user | manage | GLOBAL | No | Yes | No | No | Yes |
| `admin:manage:service-accounts`| srv-account | manage | GLOBAL | No | Yes | No | Yes | Yes |
| `admin:manage:api-keys` | api-key | manage | GLOBAL | No | Yes | No | No | Yes |
| `admin:manage:rate-limits` | rate-limit | manage | GLOBAL | No | Yes | No | No | Yes |
| `admin:read:audit-log` | audit-log | read | GLOBAL | No | No | No | No | Yes |
| `admin:export:audit-log` | audit-log | export | RESTRICTED | No | No | No | Yes | Yes |
| `admin:manage:feature-flags` | feature-flag| manage | GLOBAL | No | Yes | No | No | Yes |
| `admin:manage:network-policy` | net-policy | manage | RESTRICTED | No | Yes | Yes | Yes | Yes |
| `pds:manage:shops` | pds-shop | manage | GLOBAL | No | Yes | No | No | Yes |
| `pds:manage:warehouses` | pds-wh | manage | GLOBAL | No | Yes | No | No | Yes |
| `pds:manage:beneficiaries` | pds-ben | manage | GLOBAL | No | Yes | No | No | Yes |
| `pds:distribute:rations` | pds-dist | distribute | ENTITY | No | Yes | Yes | No | Yes |
| `pds:transfer:stock` | pds-stock | transfer | ENTITY | No | Yes | Yes | No | Yes |

---

## 3. Interface Mapping: REST, JSON-RPC, and SSE

| Route / Method / Channel | Interface | Required Permission | Allowed Roles |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/blockchain/blocks` | REST | `public:read:block` | ALL (Public) |
| `GET /api/v1/blockchain/blocks/:height` | REST | `public:read:block` | ALL (Public) |
| `GET /api/v1/transactions/:hash` | REST | `public:read:transaction` | ALL (Public) |
| `POST /api/v1/transactions` | REST | `client:submit:transaction` | `CLIENT`, `SHOP`, `WAREHOUSE`, `ADMIN`, `SUPER_ADMIN` |
| `GET /api/v1/proofs/transactions/:hash` | REST | `public:read:proof` | ALL (Public) |
| `POST /api/v1/proofs/verify` | REST | `public:read:proof` | ALL (Public) |
| `GET /api/v1/events/stream` | SSE | `client:subscribe:event` | ALL (Public; filtered by sensitivity) |
| `GET /api/v1/security/metrics` | REST | `public:read:health` | ALL (Public text export) |
| `GET /api/v1/security/audit` | REST | `admin:read:audit-log` | `ADMIN`, `SYSTEM_ADMIN`, `SUPER_ADMIN`, `AUDITOR` |
| `GET /api/v1/security/audit/export` | REST | `admin:export:audit-log` | `SYSTEM_ADMIN`, `SUPER_ADMIN` |
| `POST /api/v1/security/break-glass/activate` | REST | `admin:manage:network-policy`| `SYSTEM_ADMIN`, `SUPER_ADMIN` |
| `POST /api/v1/security/api-keys` | REST | `admin:manage:api-keys` | `ADMIN`, `API_ADMIN`, `SYSTEM_ADMIN`, `SUPER_ADMIN` |
| `pds_blockNumber` | JSON-RPC | `public:read:chain` | ALL (Public) |
| `pds_getBlockByNumber` | JSON-RPC | `public:read:block` | ALL (Public) |
| `pds_getTransactionProof` | JSON-RPC | `public:read:proof` | ALL (Public) |
| `pds_sendRawTransaction` | JSON-RPC | `client:submit:transaction` | `CLIENT`, `SHOP`, `WAREHOUSE`, `ADMIN`, `SUPER_ADMIN` |
| `pds_call` | JSON-RPC | `public:read:contract` | ALL (Public view call) |
| `pds_propose` | JSON-RPC | `client:submit:transaction` | `SHOP`, `ADMIN`, `VALIDATOR` |
| `pds_rebuildProofIndex` | JSON-RPC | `operator:trigger:reindex` | `OPERATOR`, `RECOVERY_OPERATOR`, `ADMIN` |
| `pds_rotateConsensusKey` | JSON-RPC | `security:stage:key-rotation`| `SECURITY_OPERATOR`, `SUPER_ADMIN` |

