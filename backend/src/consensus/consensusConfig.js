/**
 * 12-Validator Federated Byzantine Agreement (FBA) Configuration
 * Defines the institutional identity, public keys, port assignments, and trusted quorum slice topology.
 */

const RAW_12_VALIDATORS = [
  {
    validatorId: 'VAL-01',
    shortId: 'V1',
    name: 'Ministry of Consumer Affairs',
    org: 'Government of India',
    port: 4001,
    endpoint: 'http://127.0.0.1:4001',
    p2pPort: 5001,
    p2pEndpoint: 'http://127.0.0.1:5001',
    publicKey: '0x01A9F4C82E3B7701',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-01', 'VAL-02', 'VAL-03', 'VAL-04']
    }
  },
  {
    validatorId: 'VAL-02',
    shortId: 'V2',
    name: 'National Informatics Centre',
    org: 'NIC Technology Cell',
    port: 4002,
    endpoint: 'http://127.0.0.1:4002',
    p2pPort: 5002,
    p2pEndpoint: 'http://127.0.0.1:5002',
    publicKey: '0x02B8E3D71C4A8812',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-02', 'VAL-03', 'VAL-05', 'VAL-06']
    }
  },
  {
    validatorId: 'VAL-03',
    shortId: 'V3',
    name: 'State Food Commission',
    org: 'State Regulatory Authority',
    port: 4003,
    endpoint: 'http://127.0.0.1:4003',
    p2pPort: 5003,
    p2pEndpoint: 'http://127.0.0.1:5003',
    publicKey: '0x03C7D2A60B5C9923',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-01', 'VAL-03', 'VAL-07', 'VAL-08']
    }
  },
  {
    validatorId: 'VAL-04',
    shortId: 'V4',
    name: 'Civil Supplies Corporation',
    org: 'State Food Logistics',
    port: 4004,
    endpoint: 'http://127.0.0.1:4004',
    p2pPort: 5004,
    p2pEndpoint: 'http://127.0.0.1:5004',
    publicKey: '0x04D6C195FA6D0034',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-01', 'VAL-04', 'VAL-09', 'VAL-10']
    }
  },
  {
    validatorId: 'VAL-05',
    shortId: 'V5',
    name: 'District Administration Node',
    org: 'District Collectorate',
    port: 4005,
    endpoint: 'http://127.0.0.1:4005',
    p2pPort: 5005,
    p2pEndpoint: 'http://127.0.0.1:5005',
    publicKey: '0x05E5B084E97E1145',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-02', 'VAL-05', 'VAL-07', 'VAL-11']
    }
  },
  {
    validatorId: 'VAL-06',
    shortId: 'V6',
    name: 'Auditor General Observer Node',
    org: 'Comptroller & Auditor General',
    port: 4006,
    endpoint: 'http://127.0.0.1:4006',
    p2pPort: 5006,
    p2pEndpoint: 'http://127.0.0.1:5006',
    publicKey: '0x06F4A973D88F2256',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-02', 'VAL-06', 'VAL-08', 'VAL-12']
    }
  },
  {
    validatorId: 'VAL-07',
    shortId: 'V7',
    name: 'Public Audit & Governance Node',
    org: 'Independent Audit Council',
    port: 4007,
    endpoint: 'http://127.0.0.1:4007',
    p2pPort: 5007,
    p2pEndpoint: 'http://127.0.0.1:5007',
    publicKey: '0x07A39862C7903367',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-03', 'VAL-05', 'VAL-07', 'VAL-09']
    }
  },
  {
    validatorId: 'VAL-08',
    shortId: 'V8',
    name: 'Regional Warehouse Authority',
    org: 'Civil Supplies Depots',
    port: 4008,
    endpoint: 'http://127.0.0.1:4008',
    p2pPort: 5008,
    p2pEndpoint: 'http://127.0.0.1:5008',
    publicKey: '0x08B28751B6A14478',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-03', 'VAL-06', 'VAL-08', 'VAL-10']
    }
  },
  {
    validatorId: 'VAL-09',
    shortId: 'V9',
    name: 'Fair Price Shop Union Node',
    org: 'FPS Representative Federation',
    port: 4009,
    endpoint: 'http://127.0.0.1:4009',
    p2pPort: 5009,
    p2pEndpoint: 'http://127.0.0.1:5009',
    publicKey: '0x09C17640A5B25589',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-04', 'VAL-07', 'VAL-09', 'VAL-11']
    }
  },
  {
    validatorId: 'VAL-10',
    shortId: 'V10',
    name: 'State Monitoring Cell',
    org: 'E-Governance Cell',
    port: 4010,
    endpoint: 'http://127.0.0.1:4010',
    p2pPort: 5010,
    p2pEndpoint: 'http://127.0.0.1:5010',
    publicKey: '0x10D0653F94C36690',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-04', 'VAL-08', 'VAL-10', 'VAL-12']
    }
  },
  {
    validatorId: 'VAL-11',
    shortId: 'V11',
    name: 'Citizen Oversight Organisation',
    org: 'Civil Rights & Transparency Forum',
    port: 4011,
    endpoint: 'http://127.0.0.1:4011',
    p2pPort: 5011,
    p2pEndpoint: 'http://127.0.0.1:5011',
    publicKey: '0x11E9542E83D47701',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-05', 'VAL-09', 'VAL-11', 'VAL-12']
    }
  },
  {
    validatorId: 'VAL-12',
    shortId: 'V12',
    name: 'Security & Cryptography Validator',
    org: 'National Cryptographic Board',
    port: 4012,
    endpoint: 'http://127.0.0.1:4012',
    p2pPort: 5012,
    p2pEndpoint: 'http://127.0.0.1:5012',
    publicKey: '0x12F8431D72E58812',
    status: 'Online',
    trustConfiguration: {
      threshold: 3,
      quorumSlice: ['VAL-06', 'VAL-10', 'VAL-11', 'VAL-12']
    }
  }
];

const DEFAULT_12_VALIDATORS = RAW_12_VALIDATORS.map((v, idx) => {
  const num = idx + 1;
  const pad = String(num).padStart(2, '0');
  return {
    ...v,
    shortId: `V${num}`,
    aliases: [`V${num}`, `V${pad}`, `VAL-${pad}`, `VAL-${num}`, `VAL${pad}`, `NODE-${pad}`, `NODE-${num}`]
  };
});

/**
 * Resolve any known validator alias (V1..V12, VAL-01..VAL-12, NODE-01..NODE-12)
 * to its canonical validator ID (VAL-01..VAL-12).
 * Unknown IDs (such as 'VAL-99_UNKNOWN') are returned unchanged.
 */
function resolveValidatorId(idOrAlias) {
  if (!idOrAlias || typeof idOrAlias !== 'string') return idOrAlias;
  const trimmed = idOrAlias.trim().toUpperCase();
  const m = trimmed.match(/^(?:V|VAL-?|NODE-?)(0?[1-9]|1[0-2])$/);
  if (m) {
    const num = parseInt(m[1], 10);
    return `VAL-${String(num).padStart(2, '0')}`;
  }
  return trimmed;
}

/**
 * Return the short validator ID ('V1'..'V12') for a canonical or alias validator ID.
 */
function getShortValidatorId(idOrAlias) {
  const canonical = resolveValidatorId(idOrAlias);
  if (!canonical || typeof canonical !== 'string') return null;
  const m = canonical.match(/^VAL-(0?[1-9]|1[0-2])$/);
  if (m) {
    return `V${parseInt(m[1], 10)}`;
  }
  return canonical;
}

module.exports = {
  DEFAULT_12_VALIDATORS,
  resolveValidatorId,
  getShortValidatorId
};
