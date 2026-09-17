const {
  evmRuntime,
  contractRegistry,
  ABIEncoder,
  EVMReceipt,
  GAS_LIMITS,
  deriveEVMAddress,
  SYSTEM_EVM_ACCOUNTS
} = require('../src/evm');

describe('PDSChain EVM Runtime & Contract Execution Test Suite', () => {
  beforeAll(async () => {
    await evmRuntime.initialize();
  });

  describe('1. Contract Loading & Registry', () => {
    test('1. should load all 8 PDS contracts into registry', () => {
      const all = contractRegistry.getAllContracts();
      expect(all.length).toBe(8);

      const expectedNames = [
        'PDSRegistry',
        'BeneficiaryRegistry',
        'ShopRegistry',
        'WarehouseRegistry',
        'CommodityRegistry',
        'InventoryManager',
        'EntitlementManager',
        'DistributionManager'
      ];

      for (const name of expectedNames) {
        const contract = contractRegistry.getContract(name);
        expect(contract).toBeDefined();
        expect(contract.name).toBe(name);
        expect(contract.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
        expect(contract.codeHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
        expect(Array.isArray(contract.abi)).toBe(true);
      }
    });

    test('2. should lookup contract by deployed address', () => {
      const pdsAddr = contractRegistry.getAddress('PDSRegistry');
      const contract = contractRegistry.getContractByAddress(pdsAddr);
      expect(contract).toBeDefined();
      expect(contract.name).toBe('PDSRegistry');
    });

    test('3. should return null for non-existent contract address', () => {
      const nonExistent = contractRegistry.getContractByAddress('0x0000000000000000000000000000000000000999');
      expect(nonExistent).toBeNull();
    });
  });

  describe('2. ABI Encoding, Decoding & Log Parsing', () => {
    test('4. should encode and decode function calls deterministically', () => {
      const comMeta = contractRegistry.getContract('CommodityRegistry');
      const calldata = ABIEncoder.encodeCall(comMeta.abi, 'registerCommodity', ['Rice', 'KG']);

      expect(calldata).toMatch(/^0x[a-fA-F0-9]+/);
      expect(calldata.length).toBeGreaterThan(10);

      // Verify same call with same arguments produces identical calldata
      const calldata2 = ABIEncoder.encodeCall(comMeta.abi, 'registerCommodity', ['Rice', 'KG']);
      expect(calldata2).toBe(calldata);
    });

    test('5. should decode revert reason from standard Error(string)', () => {
      const { ethers } = require('ethers');
      const errSelector = '0x08c379a0';
      const encodedMsg = ethers.AbiCoder.defaultAbiCoder().encode(['string'], ['Insufficient inventory']).substring(2);
      const errData = errSelector + encodedMsg;

      const reason = ABIEncoder.decodeRevertReason(errData);
      expect(reason).toBe('Insufficient inventory');
    });

    test('6. should decode custom revert errors', () => {
      const reason = ABIEncoder.decodeRevertReason('0x12345678abcdef');
      expect(reason).toContain('Custom Error: 0x12345678');
    });
  });

  describe('3. Deterministic EVM Execution & Identity', () => {
    test('7. should execute view call without side-effects', async () => {
      const comAddr = contractRegistry.getAddress('CommodityRegistry');

      // Admin registers a commodity first
      const adminAddr = SYSTEM_EVM_ACCOUNTS.ADMIN;
      const regReceipt = await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-REG-RICE',
        caller: adminAddr,
        contractAddress: comAddr,
        method: 'registerCommodity',
        args: ['TestGrain', 'KG'],
        gasLimit: 500000
      });

      expect(regReceipt.isSuccess()).toBe(true);

      // View call
      const isValid = await evmRuntime.executeViewCall({
        contractAddress: comAddr,
        method: 'isValidCommodity',
        args: ['TestGrain']
      });

      expect(isValid).toBe(true);
    });

    test('8. should derive deterministic EVM addresses from PDS identifiers', () => {
      const addr1 = deriveEVMAddress('FPS-101');
      const addr2 = deriveEVMAddress('FPS-101');
      const addr3 = deriveEVMAddress('FPS-102');

      expect(addr1).toMatch(/^0x[a-f0-9]{40}$/);
      expect(addr1).toBe(addr2); // Deterministic
      expect(addr1).not.toBe(addr3); // Distinct
    });

    test('9. should return structured EVMReceipt with deterministic receiptHash', async () => {
      const comAddr = contractRegistry.getAddress('CommodityRegistry');
      const receipt = await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-RECEIPT-01',
        caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
        contractAddress: comAddr,
        method: 'registerCommodity',
        args: ['Millet', 'KG'],
        gasLimit: 500000
      });

      expect(receipt instanceof EVMReceipt).toBe(true);
      expect(receipt.status).toBe('SUCCESS');
      expect(receipt.gasUsed).toBeGreaterThan(0);
      expect(receipt.receiptHash).toMatch(/^0x[a-f0-9]{64}$/);
    });
  });

  describe('4. Isolated State Snapshots & Candidate Rollback', () => {
    test('10. should create copy-on-write checkpoint and rollback changes cleanly', async () => {
      const rootBefore = await evmRuntime.getStateRoot();

      // Create isolated checkpoint
      await evmRuntime.stateAdapter.checkpoint();

      // Execute a state-mutating call inside checkpoint
      const comAddr = contractRegistry.getAddress('CommodityRegistry');
      await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-ROLLBACK-01',
        caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
        contractAddress: comAddr,
        method: 'registerCommodity',
        args: ['TemporaryGrain', 'KG'],
        gasLimit: 500000
      });

      const rootDuring = await evmRuntime.getStateRoot();
      expect(rootDuring).not.toBe(rootBefore);

      // Revert checkpoint
      await evmRuntime.stateAdapter.revert();

      const rootAfter = await evmRuntime.getStateRoot();
      expect(rootAfter).toBe(rootBefore); // Completely restored to parent state!

      // Check that TemporaryGrain was NOT committed
      const isValid = await evmRuntime.executeViewCall({
        contractAddress: comAddr,
        method: 'isValidCommodity',
        args: ['TemporaryGrain']
      });

      expect(isValid).toBe(false);
    });

    test('11. should commit candidate state permanently when commit() is called', async () => {
      const rootBefore = await evmRuntime.getStateRoot();

      await evmRuntime.stateAdapter.checkpoint();

      const comAddr = contractRegistry.getAddress('CommodityRegistry');
      await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-COMMIT-01',
        caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
        contractAddress: comAddr,
        method: 'registerCommodity',
        args: ['PermanentBarley', 'KG'],
        gasLimit: 500000
      });

      // Commit checkpoint
      await evmRuntime.stateAdapter.commit();

      const rootAfter = await evmRuntime.getStateRoot();
      expect(rootAfter).not.toBe(rootBefore);

      const isValid = await evmRuntime.executeViewCall({
        contractAddress: comAddr,
        method: 'isValidCommodity',
        args: ['PermanentBarley']
      });

      expect(isValid).toBe(true);
    });
  });

  describe('5. Gas Accounting & Execution Resource Limits', () => {
    test('12. should cap requested gas at maximum transaction gas limit', async () => {
      const comAddr = contractRegistry.getAddress('CommodityRegistry');

      // Request exceeding TRANSACTION_GAS_LIMIT (1,000,000)
      const excessiveGas = 5_000_000;
      const receipt = await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-GAS-01',
        caller: SYSTEM_EVM_ACCOUNTS.ADMIN,
        contractAddress: comAddr,
        method: 'registerCommodity',
        args: ['Oats', 'KG'],
        gasLimit: excessiveGas
      });

      expect(receipt.status).toBe('REVERT');
      expect(receipt.revertReason).toContain('exceeds transaction gas limit');
    });

    test('13. should handle execution revert and report revert reason', async () => {
      const benAddr = contractRegistry.getAddress('BeneficiaryRegistry');

      // Attempt to register beneficiary with unauthorized caller
      const unauthorizedCaller = '0x0000000000000000000000000000000000000888';
      const receipt = await evmRuntime.executeContractCall({
        transactionId: 'TXN-TEST-UNAUTH-01',
        caller: unauthorizedCaller,
        contractAddress: benAddr,
        method: 'registerBeneficiary',
        args: ['BEN-999', 'AAY', 4],
        gasLimit: 500000
      });

      expect(receipt.isRevert()).toBe(true);
      expect(receipt.revertReason).toBeDefined();
    });
  });
});

