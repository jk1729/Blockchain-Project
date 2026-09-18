/**
 * PDSChain Canonical Permission Registry (Phase 17)
 * 
 * Formalized, frozen registry of all system permissions.
 * Follows the canonical resource:action:scope schema.
 * 
 * All actions in PDSChain must map to a registered permission.
 * Default policy is strictly DEFAULT DENY.
 */

const ScopeType = Object.freeze({
  GLOBAL: 'GLOBAL',
  ENTITY: 'ENTITY',      // Scoped to specific beneficiary, shop, or warehouse ID
  VALIDATOR: 'VALIDATOR',// Scoped to specific validator node ID
  USER: 'USER',          // Scoped to user's own identity
  RESTRICTED: 'RESTRICTED' // Highly sensitive, requires elevated approval / MFA
});

const PermissionDefinitions = Object.freeze({
  // --- Public & Explorer Permissions ---
  'public:read:chain': {
    resource: 'chain',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read overall blockchain summary, height, and status'
  },
  'public:read:block': {
    resource: 'block',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query block by height or hash'
  },
  'public:read:transaction': {
    resource: 'transaction',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query transaction details and execution receipt'
  },
  'public:read:receipt': {
    resource: 'receipt',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query execution receipt by transaction hash'
  },
  'public:read:contract': {
    resource: 'contract',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query public contract code, ABI, or execution state'
  },
  'public:read:event': {
    resource: 'event',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query public finalized blockchain event logs'
  },
  'public:read:proof': {
    resource: 'proof',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Generate or verify Merkle inclusion proofs'
  },
  'public:read:validator-summary': {
    resource: 'validator',
    action: 'read-summary',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query public summary of consortium validators'
  },
  'public:read:network-summary': {
    resource: 'network',
    action: 'read-summary',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query public network topology and health metrics'
  },
  'public:read:health': {
    resource: 'health',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read liveness and readiness health probes'
  },
  'public:read:api-docs': {
    resource: 'docs',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: true,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Access OpenAPI and JSON-RPC specification documentation'
  },

  // --- Authenticated Client Permissions ---
  'client:submit:transaction': {
    resource: 'transaction',
    action: 'submit',
    scope: ScopeType.ENTITY,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Submit raw or signed transaction to mempool'
  },
  'client:read:transaction-status': {
    resource: 'transaction',
    action: 'read-status',
    scope: ScopeType.USER,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query status of transactions submitted by user'
  },
  'client:read:receipt': {
    resource: 'receipt',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Authenticated query for transaction receipt'
  },
  'client:read:event': {
    resource: 'event',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Authenticated query for blockchain events'
  },
  'client:read:proof': {
    resource: 'proof',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Authenticated query for Merkle inclusion proofs'
  },
  'client:execute:readonly-call': {
    resource: 'contract',
    action: 'call',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Execute read-only view call on smart contract'
  },
  'client:estimate:gas': {
    resource: 'contract',
    action: 'estimate-gas',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Estimate execution gas for smart contract transaction'
  },
  'client:subscribe:event': {
    resource: 'event',
    action: 'subscribe',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Subscribe to real-time client event streams'
  },
  'client:read:account': {
    resource: 'account',
    action: 'read',
    scope: ScopeType.USER,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query account balance, nonce, and profile'
  },

  // --- Validator Permissions ---
  'validator:authenticate:peer': {
    resource: 'peer',
    action: 'authenticate',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Authenticate peer connection via mutual TLS'
  },
  'validator:read:peer-status': {
    resource: 'peer',
    action: 'read-status',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read live connected peer status'
  },
  'validator:send:proposal': {
    resource: 'consensus',
    action: 'send-proposal',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Broadcast signed block proposal in FBA round'
  },
  'validator:send:vote': {
    resource: 'consensus',
    action: 'send-vote',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Broadcast signed FBA vote for block'
  },
  'validator:send:certificate': {
    resource: 'consensus',
    action: 'send-certificate',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Broadcast finalized consensus certificate'
  },
  'validator:send:round-change': {
    resource: 'consensus',
    action: 'send-round-change',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Broadcast round change proposal upon timeout'
  },
  'validator:request:sync': {
    resource: 'sync',
    action: 'request-sync',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: false,
    description: 'Request ledger range sync from peer'
  },
  'validator:send:sync-response': {
    resource: 'sync',
    action: 'send-sync-response',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: false,
    description: 'Serve block range sync response to peer'
  },
  'validator:read:consensus-state': {
    resource: 'consensus',
    action: 'read-state',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read active FBA consensus state machine state'
  },
  'validator:read:finalized-ledger': {
    resource: 'ledger',
    action: 'read-finalized',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read authoritative finalized block data'
  },
  'validator:write:consensus-journal': {
    resource: 'journal',
    action: 'write-consensus',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: false,
    description: 'Append consensus state to local write-ahead log'
  },
  'validator:write:checkpoint': {
    resource: 'checkpoint',
    action: 'write',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Write verified ledger checkpoint record'
  },
  'validator:participate:consensus': {
    resource: 'consensus',
    action: 'participate',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Full active consensus participation'
  },

  // --- Operator Permissions ---
  'operator:read:node-status': {
    resource: 'node',
    action: 'read-status',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read detailed validator process diagnostics'
  },
  'operator:read:network-status': {
    resource: 'network',
    action: 'read-status',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read full peer mesh connection telemetry'
  },
  'operator:read:sync-status': {
    resource: 'sync',
    action: 'read-status',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Inspect ledger synchronization pipeline status'
  },
  'operator:read:recovery-status': {
    resource: 'recovery',
    action: 'read-status',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Inspect ledger recovery and verification state'
  },
  'operator:read:security-events': {
    resource: 'event',
    action: 'read-security',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Query security, TLS, and peer audit events'
  },
  'operator:read:audit-events': {
    resource: 'audit',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Read system audit log events'
  },
  'operator:read:metrics': {
    resource: 'metrics',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Access detailed node runtime and security metrics'
  },
  'operator:manage:validator-process': {
    resource: 'process',
    action: 'manage',
    scope: ScopeType.VALIDATOR,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Restart or stop validator daemon process'
  },
  'operator:manage:peer': {
    resource: 'peer',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Update peer endpoint configuration'
  },
  'operator:manage:configuration': {
    resource: 'config',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Reload node runtime configuration'
  },
  'operator:manage:log-level': {
    resource: 'config',
    action: 'set-log-level',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Dynamically update logging verbosity'
  },
  'operator:trigger:reindex': {
    resource: 'index',
    action: 'trigger-rebuild',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Trigger rebuild of derived proof or event indexes'
  },
  'operator:trigger:sync': {
    resource: 'sync',
    action: 'trigger',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Trigger manual sync check against peer set'
  },
  'operator:trigger:backup': {
    resource: 'backup',
    action: 'create',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Create an atomic ledger backup snapshot'
  },
  'operator:restore:node': {
    resource: 'backup',
    action: 'restore',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Restore node from verified backup'
  },
  'operator:approve:recovery': {
    resource: 'recovery',
    action: 'approve',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Approve execution of recovery plan'
  },

  // --- TLS & Certificate Permissions ---
  'security:read:tls-status': {
    resource: 'tls',
    action: 'read-status',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read TLS expiry tier and certificate status'
  },
  'security:read:certificate-metadata': {
    resource: 'certificate',
    action: 'read-metadata',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Inspect certificate fingerprints, SANs, and validity'
  },
  'security:reload:certificate': {
    resource: 'certificate',
    action: 'reload',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Hot-reload TLS certificates from disk without restart'
  },
  'security:rotate:certificate': {
    resource: 'certificate',
    action: 'rotate',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: true,
    auditRequired: true,
    description: 'Rotate mTLS client/server certificates'
  },
  'security:revoke:certificate': {
    resource: 'certificate',
    action: 'revoke',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Revoke certificate and add fingerprint to CRL'
  },
  'security:manage:trust-store': {
    resource: 'trust-store',
    action: 'manage',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Update consortium CA trust anchors'
  },
  'security:manage:crl': {
    resource: 'crl',
    action: 'manage',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Manage certificate revocation list'
  },

  // --- Consensus Key & Keystore Permissions ---
  'security:read:key-metadata': {
    resource: 'key',
    action: 'read-metadata',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Read active consensus key ID, public key, and epoch'
  },
  'security:load:key': {
    resource: 'keystore',
    action: 'load-key',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Unlock and decrypt in-memory consensus key'
  },
  'security:stage:key-rotation': {
    resource: 'key',
    action: 'stage-rotation',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Stage future consensus key for activation height'
  },
  'security:activate:key-rotation': {
    resource: 'key',
    action: 'activate-rotation',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Activate staged consensus key'
  },
  'security:rollback:key-rotation': {
    resource: 'key',
    action: 'rollback-rotation',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Cancel un-activated staged key rotation'
  },
  'security:revoke:identity': {
    resource: 'identity',
    action: 'revoke',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Permanently revoke validator identity'
  },
  'security:manage:peer-authorization': {
    resource: 'peer-auth',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Authorize, suspend, or revoke peer in registry'
  },
  'security:manage:keystore': {
    resource: 'keystore',
    action: 'manage',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Create, re-encrypt, or backup keystore files'
  },
  'security:destroy:key-material': {
    resource: 'key',
    action: 'destroy',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Cryptographically shred key material from disk/memory'
  },

  // --- Recovery & Ledger Permissions ---
  'recovery:read:status': {
    resource: 'recovery',
    action: 'read-status',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: false,
    description: 'Query recovery pipeline status'
  },
  'recovery:verify:checkpoint': {
    resource: 'checkpoint',
    action: 'verify',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Cryptographically verify ledger checkpoint'
  },
  'recovery:replay:journal': {
    resource: 'journal',
    action: 'replay',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Replay journal to restore in-memory state'
  },
  'recovery:rebuild:index': {
    resource: 'index',
    action: 'rebuild',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Rebuild derived indexes from ledger journal'
  },
  'recovery:trigger:sync': {
    resource: 'sync',
    action: 'trigger-recovery-sync',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Initiate catch-up synchronization during recovery'
  },
  'recovery:repair:derived-state': {
    resource: 'state',
    action: 'repair-derived',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Repair non-authoritative derived state tables'
  },
  'recovery:rollback:nonfinalized-state': {
    resource: 'state',
    action: 'rollback-nonfinalized',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Rollback uncommitted unfinalized state after crash'
  },
  'recovery:halt:validator': {
    resource: 'validator',
    action: 'halt',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Gracefully halt consensus engine for maintenance'
  },
  'recovery:resume:validator': {
    resource: 'validator',
    action: 'resume',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Resume consensus engine from halted state'
  },
  'recovery:restore:backup': {
    resource: 'backup',
    action: 'restore',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Perform verified ledger restoration from archive'
  },

  // --- Administrative Permissions ---
  'admin:manage:roles': {
    resource: 'role',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: true,
    auditRequired: true,
    description: 'Assign or revoke roles to users'
  },
  'admin:manage:permissions': {
    resource: 'permission',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: true,
    auditRequired: true,
    description: 'Modify role-permission matrix policies'
  },
  'admin:manage:users': {
    resource: 'user',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Create, update, or deactivate user accounts'
  },
  'admin:manage:service-accounts': {
    resource: 'service-account',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: true,
    auditRequired: true,
    description: 'Manage automated service account credentials'
  },
  'admin:manage:api-keys': {
    resource: 'api-key',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Issue, rotate, or revoke API access keys'
  },
  'admin:manage:rate-limits': {
    resource: 'rate-limit',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Configure rate limiting tiers and burst limits'
  },
  'admin:read:audit-log': {
    resource: 'audit-log',
    action: 'read',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Query security audit log entries'
  },
  'admin:export:audit-log': {
    resource: 'audit-log',
    action: 'export',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: false,
    isConsensusCritical: false,
    requiresMFA: true,
    auditRequired: true,
    description: 'Export verifiable security audit journal'
  },
  'admin:manage:feature-flags': {
    resource: 'feature-flag',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Toggle system runtime feature flags'
  },
  'admin:manage:network-policy': {
    resource: 'network-policy',
    action: 'manage',
    scope: ScopeType.RESTRICTED,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: true,
    auditRequired: true,
    description: 'Configure consortium network boundary and firewall rules'
  },

  // --- PDS Application Domain Permissions ---
  'pds:manage:shops': {
    resource: 'pds-shop',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Register and update Fair Price Shops'
  },
  'pds:manage:warehouses': {
    resource: 'pds-warehouse',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Register and update government warehouses'
  },
  'pds:manage:beneficiaries': {
    resource: 'pds-beneficiary',
    action: 'manage',
    scope: ScopeType.GLOBAL,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: false,
    requiresMFA: false,
    auditRequired: true,
    description: 'Enroll and update ration card beneficiaries'
  },
  'pds:distribute:rations': {
    resource: 'pds-distribution',
    action: 'distribute',
    scope: ScopeType.ENTITY,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Issue ration quota from assigned Fair Price Shop'
  },
  'pds:transfer:stock': {
    resource: 'pds-stock',
    action: 'transfer',
    scope: ScopeType.ENTITY,
    isPublic: false,
    isMutating: true,
    isConsensusCritical: true,
    requiresMFA: false,
    auditRequired: true,
    description: 'Transfer commodity stock from warehouse to shop'
  }
});

class PermissionRegistry {
  static get(permissionId) {
    if (!permissionId || typeof permissionId !== 'string') return null;
    return PermissionDefinitions[permissionId.trim()] || null;
  }

  static has(permissionId) {
    if (!permissionId || typeof permissionId !== 'string') return false;
    return Object.prototype.hasOwnProperty.call(PermissionDefinitions, permissionId.trim());
  }

  static getAllIds() {
    return Object.keys(PermissionDefinitions);
  }

  static getAll() {
    return { ...PermissionDefinitions };
  }

  static getPublicPermissions() {
    return Object.entries(PermissionDefinitions)
      .filter(([_, def]) => def.isPublic)
      .map(([id]) => id);
  }

  static getScopeType() {
    return ScopeType;
  }
}

module.exports = {
  ScopeType,
  PermissionDefinitions,
  PermissionRegistry
};

