const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * PDSChain Contract Artifact & Address Registry
 * 
 * Loads compiled Solidity contract bytecode, ABIs, and maintains deterministic contract addresses.
 */

const DEFAULT_CONTRACT_ADDRESSES = {
  PDSRegistry: '0x1000000000000000000000000000000000000001',
  BeneficiaryRegistry: '0x1000000000000000000000000000000000000002',
  ShopRegistry: '0x1000000000000000000000000000000000000003',
  WarehouseRegistry: '0x1000000000000000000000000000000000000004',
  CommodityRegistry: '0x1000000000000000000000000000000000000005',
  InventoryManager: '0x1000000000000000000000000000000000000006',
  EntitlementManager: '0x1000000000000000000000000000000000000007',
  DistributionManager: '0x1000000000000000000000000000000000000008'
};

class ContractRegistry {
  constructor(artifactsBaseDir = null) {
    this.artifactsBaseDir = artifactsBaseDir || path.resolve(__dirname, '../../../contracts/artifacts/contracts');
    this.contracts = new Map();
    this.addressToName = new Map();
    this.deployedAddresses = { ...DEFAULT_CONTRACT_ADDRESSES };
    this.loadAllArtifacts();
  }

  /**
   * Resolve path to Hardhat artifact JSON
   */
  getArtifactPath(subpath, contractName) {
    return path.join(this.artifactsBaseDir, subpath, `${contractName}.sol`, `${contractName}.json`);
  }

  /**
   * Load and cache artifact metadata
   */
  loadArtifact(subpath, contractName) {
    const artifactPath = this.getArtifactPath(subpath, contractName);
    if (!fs.existsSync(artifactPath)) {
      return null;
    }

    try {
      const data = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      const codeHash = crypto.createHash('sha256').update(data.bytecode || '').digest('hex');

      const meta = {
        name: contractName,
        abi: data.abi,
        bytecode: data.bytecode,
        deployedBytecode: data.deployedBytecode,
        codeHash: `0x${codeHash}`,
        address: this.deployedAddresses[contractName] || null
      };

      this.contracts.set(contractName, meta);
      if (meta.address) {
        this.addressToName.set(meta.address.toLowerCase(), contractName);
      }
      return meta;
    } catch (e) {
      return null;
    }
  }

  /**
   * Pre-load all known PDS smart contracts
   */
  loadAllArtifacts() {
    const definitions = [
      { subpath: 'core', name: 'PDSRegistry' },
      { subpath: 'registry', name: 'BeneficiaryRegistry' },
      { subpath: 'registry', name: 'ShopRegistry' },
      { subpath: 'registry', name: 'WarehouseRegistry' },
      { subpath: 'registry', name: 'CommodityRegistry' },
      { subpath: 'inventory', name: 'InventoryManager' },
      { subpath: 'inventory', name: 'EntitlementManager' },
      { subpath: 'distribution', name: 'DistributionManager' }
    ];

    for (const def of definitions) {
      this.loadArtifact(def.subpath, def.name);
    }
  }

  getContract(name) {
    return this.contracts.get(name) || null;
  }

  getContractByAddress(address) {
    if (!address) return null;
    const name = this.addressToName.get(address.toLowerCase());
    return name ? this.contracts.get(name) : null;
  }

  getAddress(name) {
    return this.deployedAddresses[name] || null;
  }

  getAllContracts() {
    return Array.from(this.contracts.values());
  }

  setContractAddress(name, address) {
    this.deployedAddresses[name] = address;
    const existing = this.contracts.get(name);
    if (existing) {
      existing.address = address;
      this.addressToName.set(address.toLowerCase(), name);
    }
  }
}

module.exports = new ContractRegistry();

