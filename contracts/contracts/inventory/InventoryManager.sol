// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";
import "../registry/ShopRegistry.sol";
import "../registry/WarehouseRegistry.sol";
import "../registry/CommodityRegistry.sol";

/**
 * @title InventoryManager
 * @notice Manages physical grain inventory balances across warehouses and Fair Price Shops.
 * Enforces atomic stock transfers and prevents stock deficits.
 */
contract InventoryManager {
    PDSRegistry public immutable registry;

    // warehouseId => commodity => balance (in standard integer units, e.g., KG)
    mapping(string => mapping(string => uint256)) private _warehouseStock;

    // shopId => commodity => balance
    mapping(string => mapping(string => uint256)) private _shopStock;

    event StockAllocated(string indexed entityId, bool isShop, string indexed commodity, uint256 amount, address indexed by);
    event StockTransferred(string indexed warehouseId, string indexed shopId, string commodity, uint256 amount, address indexed by);
    event StockDeducted(string indexed shopId, string indexed commodity, uint256 amount, address indexed by);

    error OnlyAdminAllowed();
    error OnlyWarehouseManagerOrAdminAllowed();
    error OnlyDistributionManagerAllowed();
    error InactiveWarehouse(string warehouseId);
    error InactiveShop(string shopId);
    error InvalidCommodity(string commodity);
    error InsufficientWarehouseStock(string warehouseId, string commodity, uint256 available, uint256 requested);
    error InsufficientShopStock(string shopId, string commodity, uint256 available, uint256 requested);
    error InvalidQuantity();

    modifier onlyAdmin() {
        if (!registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert OnlyAdminAllowed();
        }
        _;
    }

    modifier onlyDistributionManager() {
        if (msg.sender != registry.distributionManager() && !registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert OnlyDistributionManagerAllowed();
        }
        _;
    }

    constructor(address _pdsRegistry) {
        require(_pdsRegistry != address(0), "Invalid PDSRegistry address");
        registry = PDSRegistry(_pdsRegistry);
    }

    function addWarehouseStock(
        string calldata warehouseId,
        string calldata commodity,
        uint256 amount
    ) external {
        if (amount == 0) revert InvalidQuantity();
        
        WarehouseRegistry whReg = WarehouseRegistry(registry.warehouseRegistry());
        if (!whReg.isWarehouseActive(warehouseId)) revert InactiveWarehouse(warehouseId);
        
        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);

        // Caller must be warehouse manager or admin
        if (!whReg.isWarehouseManager(warehouseId, msg.sender) && !registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert OnlyWarehouseManagerOrAdminAllowed();
        }

        _warehouseStock[warehouseId][commodity] += amount;
        emit StockAllocated(warehouseId, false, commodity, amount, msg.sender);
    }

    function addShopStock(
        string calldata shopId,
        string calldata commodity,
        uint256 amount
    ) external onlyAdmin {
        if (amount == 0) revert InvalidQuantity();

        ShopRegistry shopReg = ShopRegistry(registry.shopRegistry());
        if (!shopReg.isShopActive(shopId)) revert InactiveShop(shopId);

        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);

        _shopStock[shopId][commodity] += amount;
        emit StockAllocated(shopId, true, commodity, amount, msg.sender);
    }

    function transferToShop(
        string calldata warehouseId,
        string calldata shopId,
        string calldata commodity,
        uint256 amount
    ) external {
        if (amount == 0) revert InvalidQuantity();

        WarehouseRegistry whReg = WarehouseRegistry(registry.warehouseRegistry());
        if (!whReg.isWarehouseActive(warehouseId)) revert InactiveWarehouse(warehouseId);

        // Caller check: Warehouse manager or Admin
        if (!whReg.isWarehouseManager(warehouseId, msg.sender) && !registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert OnlyWarehouseManagerOrAdminAllowed();
        }

        ShopRegistry shopReg = ShopRegistry(registry.shopRegistry());
        if (!shopReg.isShopActive(shopId)) revert InactiveShop(shopId);

        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);

        uint256 currentWhStock = _warehouseStock[warehouseId][commodity];
        if (currentWhStock < amount) {
            revert InsufficientWarehouseStock(warehouseId, commodity, currentWhStock, amount);
        }

        _warehouseStock[warehouseId][commodity] = currentWhStock - amount;
        _shopStock[shopId][commodity] += amount;

        emit StockTransferred(warehouseId, shopId, commodity, amount, msg.sender);
    }

    function deductShopStock(
        string calldata shopId,
        string calldata commodity,
        uint256 amount
    ) external onlyDistributionManager {
        if (amount == 0) revert InvalidQuantity();

        uint256 currentShopStock = _shopStock[shopId][commodity];
        if (currentShopStock < amount) {
            revert InsufficientShopStock(shopId, commodity, currentShopStock, amount);
        }

        _shopStock[shopId][commodity] = currentShopStock - amount;
        emit StockDeducted(shopId, commodity, amount, msg.sender);
    }

    function getWarehouseStock(string calldata warehouseId, string calldata commodity) external view returns (uint256) {
        return _warehouseStock[warehouseId][commodity];
    }

    function getShopStock(string calldata shopId, string calldata commodity) external view returns (uint256) {
        return _shopStock[shopId][commodity];
    }
}
