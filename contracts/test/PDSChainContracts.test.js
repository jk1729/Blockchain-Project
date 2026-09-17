const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PDSChain Native Solidity Smart Contracts", function () {
  let admin, shopOperator, warehouseManager, inspector, citizen, unauthorized;
  let pdsRegistry, benRegistry, shopRegistry, whRegistry, comRegistry, invManager, entManager, distManager;

  const PERIOD = "2026-09";

  beforeEach(async function () {
    [admin, shopOperator, warehouseManager, inspector, citizen, unauthorized] = await ethers.getSigners();

    // 1. Deploy Master Registry
    const PDSRegistry = await ethers.getContractFactory("PDSRegistry");
    pdsRegistry = await PDSRegistry.deploy();
    await pdsRegistry.waitForDeployment();
    const pdsRegistryAddr = await pdsRegistry.getAddress();

    // 2. Deploy Subsystem Contracts
    const BeneficiaryRegistry = await ethers.getContractFactory("BeneficiaryRegistry");
    benRegistry = await BeneficiaryRegistry.deploy(pdsRegistryAddr);
    await benRegistry.waitForDeployment();

    const ShopRegistry = await ethers.getContractFactory("ShopRegistry");
    shopRegistry = await ShopRegistry.deploy(pdsRegistryAddr);
    await shopRegistry.waitForDeployment();

    const WarehouseRegistry = await ethers.getContractFactory("WarehouseRegistry");
    whRegistry = await WarehouseRegistry.deploy(pdsRegistryAddr);
    await whRegistry.waitForDeployment();

    const CommodityRegistry = await ethers.getContractFactory("CommodityRegistry");
    comRegistry = await CommodityRegistry.deploy(pdsRegistryAddr);
    await comRegistry.waitForDeployment();

    const InventoryManager = await ethers.getContractFactory("InventoryManager");
    invManager = await InventoryManager.deploy(pdsRegistryAddr);
    await invManager.waitForDeployment();

    const EntitlementManager = await ethers.getContractFactory("EntitlementManager");
    entManager = await EntitlementManager.deploy(pdsRegistryAddr);
    await entManager.waitForDeployment();

    const DistributionManager = await ethers.getContractFactory("DistributionManager");
    distManager = await DistributionManager.deploy(pdsRegistryAddr);
    await distManager.waitForDeployment();

    // 3. Register All Subsystem Addresses in Master PDSRegistry
    await pdsRegistry.setBeneficiaryRegistry(await benRegistry.getAddress());
    await pdsRegistry.setShopRegistry(await shopRegistry.getAddress());
    await pdsRegistry.setWarehouseRegistry(await whRegistry.getAddress());
    await pdsRegistry.setCommodityRegistry(await comRegistry.getAddress());
    await pdsRegistry.setInventoryManager(await invManager.getAddress());
    await pdsRegistry.setEntitlementManager(await entManager.getAddress());
    await pdsRegistry.setDistributionManager(await distManager.getAddress());

    // 4. Initial System Setup: Commodities
    await comRegistry.registerCommodity("Rice", "KG");
    await comRegistry.registerCommodity("Wheat", "KG");
    await comRegistry.registerCommodity("Sugar", "KG");

    // 5. Initial System Setup: Shop and Warehouse
    await shopRegistry.registerShop("FPS-101", shopOperator.address, "North District");
    await whRegistry.registerWarehouse("WH-001", warehouseManager.address, 100000);

    // 6. Initial System Setup: Beneficiary
    await benRegistry.registerBeneficiary("BEN-001", "AAY", 5);
    await entManager.setCategoryQuota("AAY", "Rice", 35);
    await entManager.setCategoryQuota("AAY", "Wheat", 15);
  });

  describe("1. System Registry & Access Control", function () {
    it("should initialize with deployer as default admin", async function () {
      expect(await pdsRegistry.hasRole(await pdsRegistry.DEFAULT_ADMIN_ROLE(), admin.address)).to.be.true;
      expect(await pdsRegistry.hasRole(await pdsRegistry.DEFAULT_ADMIN_ROLE(), unauthorized.address)).to.be.false;
    });

    it("should allow admin to grant and revoke roles", async function () {
      const INSPECTOR_ROLE = await pdsRegistry.INSPECTOR_ROLE();
      await pdsRegistry.grantRole(INSPECTOR_ROLE, inspector.address);
      expect(await pdsRegistry.hasRole(INSPECTOR_ROLE, inspector.address)).to.be.true;

      await pdsRegistry.revokeRole(INSPECTOR_ROLE, inspector.address);
      expect(await pdsRegistry.hasRole(INSPECTOR_ROLE, inspector.address)).to.be.false;
    });

    it("should prevent unauthorized actors from granting roles", async function () {
      const SHOP_ROLE = await pdsRegistry.SHOP_ROLE();
      await expect(
        pdsRegistry.connect(unauthorized).grantRole(SHOP_ROLE, unauthorized.address)
      ).to.be.revertedWithCustomError(pdsRegistry, "UnauthorizedRole");
    });

    it("should pause and unpause system via circuit breaker", async function () {
      expect(await pdsRegistry.paused()).to.be.false;
      await pdsRegistry.setPaused(true);
      expect(await pdsRegistry.paused()).to.be.true;
      await pdsRegistry.setPaused(false);
      expect(await pdsRegistry.paused()).to.be.false;
    });
  });

  describe("2. Beneficiary Management & Privacy", function () {
    it("should register beneficiary without any sensitive PII on-chain", async function () {
      const [category, familySize, isActive, timestamp] = await benRegistry.getBeneficiary("BEN-001");
      expect(category).to.equal("AAY");
      expect(familySize).to.equal(5n);
      expect(isActive).to.be.true;
      expect(timestamp).to.be.greaterThan(0n);
      expect(await benRegistry.isEligible("BEN-001")).to.be.true;
    });

    it("should reject duplicate beneficiary registration", async function () {
      await expect(
        benRegistry.registerBeneficiary("BEN-001", "AAY", 4)
      ).to.be.revertedWithCustomError(benRegistry, "BeneficiaryAlreadyExists");
    });

    it("should allow admin to deactivate beneficiary and render ineligible", async function () {
      await benRegistry.setBeneficiaryStatus("BEN-001", false);
      expect(await benRegistry.isEligible("BEN-001")).to.be.false;
    });
  });

  describe("3. Fair Price Shop & Warehouse Registries", function () {
    it("should correctly record shop operator and operational status", async function () {
      const [operator, district, isActive] = await shopRegistry.getShop("FPS-101");
      expect(operator).to.equal(shopOperator.address);
      expect(district).to.equal("North District");
      expect(isActive).to.be.true;
      expect(await shopRegistry.isShopOperator("FPS-101", shopOperator.address)).to.be.true;
      expect(await shopRegistry.isShopOperator("FPS-101", unauthorized.address)).to.be.false;
    });

    it("should correctly record warehouse manager and operational capacity", async function () {
      const [manager, capacity, isActive] = await whRegistry.getWarehouse("WH-001");
      expect(manager).to.equal(warehouseManager.address);
      expect(capacity).to.equal(100000n);
      expect(isActive).to.be.true;
      expect(await whRegistry.isWarehouseManager("WH-001", warehouseManager.address)).to.be.true;
    });
  });

  describe("4. Inventory Balances & Stock Transfers", function () {
    it("should allow warehouse manager to receive stock and transfer to shop", async function () {
      // 1. Warehouse receives 5,000 KG Rice
      await invManager.connect(warehouseManager).addWarehouseStock("WH-001", "Rice", 5000);
      expect(await invManager.getWarehouseStock("WH-001", "Rice")).to.equal(5000n);

      // 2. Transfer 1,000 KG Rice to FPS-101
      await invManager.connect(warehouseManager).transferToShop("WH-001", "FPS-101", "Rice", 1000);
      expect(await invManager.getWarehouseStock("WH-001", "Rice")).to.equal(4000n);
      expect(await invManager.getShopStock("FPS-101", "Rice")).to.equal(1000n);
    });

    it("should reject transfer when warehouse has insufficient inventory", async function () {
      await invManager.connect(warehouseManager).addWarehouseStock("WH-001", "Rice", 100);
      await expect(
        invManager.connect(warehouseManager).transferToShop("WH-001", "FPS-101", "Rice", 500)
      ).to.be.revertedWithCustomError(invManager, "InsufficientWarehouseStock");
    });

    it("should prevent unauthorized accounts from transferring warehouse stock", async function () {
      await invManager.connect(warehouseManager).addWarehouseStock("WH-001", "Rice", 5000);
      await expect(
        invManager.connect(unauthorized).transferToShop("WH-001", "FPS-101", "Rice", 500)
      ).to.be.revertedWithCustomError(invManager, "OnlyWarehouseManagerOrAdminAllowed");
    });
  });

  describe("5. Entitlement Quota Management", function () {
    it("should calculate correct remaining quota for citizen in a period", async function () {
      expect(await entManager.getMonthlyQuota("BEN-001", "Rice")).to.equal(35n);
      expect(await entManager.getClaimed("BEN-001", PERIOD, "Rice")).to.equal(0n);
      expect(await entManager.getRemainingQuota("BEN-001", PERIOD, "Rice")).to.equal(35n);
    });

    it("should allow custom beneficiary quota override", async function () {
      await entManager.setBeneficiaryQuota("BEN-001", "Rice", 50);
      expect(await entManager.getMonthlyQuota("BEN-001", "Rice")).to.equal(50n);
    });
  });

  describe("6. Atomic Ration Distribution Workflow", function () {
    beforeEach(async function () {
      // Stock the shop with 1,000 KG Rice
      await invManager.connect(warehouseManager).addWarehouseStock("WH-001", "Rice", 5000);
      await invManager.connect(warehouseManager).transferToShop("WH-001", "FPS-101", "Rice", 1000);
    });

    it("should successfully execute grain distribution and emit RationDistributed event", async function () {
      const tx = await distManager.connect(shopOperator).distributeRation(
        "BEN-001",
        "FPS-101",
        "Rice",
        10,
        PERIOD
      );

      await expect(tx)
        .to.emit(distManager, "RationDistributed");

      // Verify state changes
      expect(await invManager.getShopStock("FPS-101", "Rice")).to.equal(990n);
      expect(await entManager.getClaimed("BEN-001", PERIOD, "Rice")).to.equal(10n);
      expect(await entManager.getRemainingQuota("BEN-001", PERIOD, "Rice")).to.equal(25n);
    });

    it("should reject distribution if requested quantity exceeds remaining quota", async function () {
      // Quota is 35 KG, request 40 KG
      await expect(
        distManager.connect(shopOperator).distributeRation("BEN-001", "FPS-101", "Rice", 40, PERIOD)
      ).to.be.revertedWithCustomError(entManager, "QuotaExceeded");

      // Verify atomic rollback: shop stock and claimed unchanged
      expect(await invManager.getShopStock("FPS-101", "Rice")).to.equal(1000n);
      expect(await entManager.getClaimed("BEN-001", PERIOD, "Rice")).to.equal(0n);
    });

    it("should reject distribution if shop has insufficient stock", async function () {
      // Set custom quota to 2000 KG but shop only has 1000 KG
      await entManager.setBeneficiaryQuota("BEN-001", "Rice", 2000);
      await expect(
        distManager.connect(shopOperator).distributeRation("BEN-001", "FPS-101", "Rice", 1500, PERIOD)
      ).to.be.revertedWithCustomError(invManager, "InsufficientShopStock");

      // Quota remains unconsumed
      expect(await entManager.getClaimed("BEN-001", PERIOD, "Rice")).to.equal(0n);
    });

    it("should reject distribution from unauthorized operator", async function () {
      await expect(
        distManager.connect(unauthorized).distributeRation("BEN-001", "FPS-101", "Rice", 10, PERIOD)
      ).to.be.revertedWithCustomError(distManager, "UnauthorizedOperator");
    });

    it("should reject distribution if beneficiary is deactivated", async function () {
      await benRegistry.setBeneficiaryStatus("BEN-001", false);
      await expect(
        distManager.connect(shopOperator).distributeRation("BEN-001", "FPS-101", "Rice", 10, PERIOD)
      ).to.be.revertedWithCustomError(distManager, "IneligibleBeneficiary");
    });

    it("should reject distribution when system is paused by emergency circuit breaker", async function () {
      await pdsRegistry.setPaused(true);
      await expect(
        distManager.connect(shopOperator).distributeRation("BEN-001", "FPS-101", "Rice", 10, PERIOD)
      ).to.be.revertedWithCustomError(distManager, "SystemPaused");
    });
  });
});

