// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "./AccessControl.sol";

/**
 * @title PDSRegistry
 * @notice Master system directory and governance registry for PDSChain.
 * Maintains authorized contract addresses, emergency controls, and role registries.
 */
contract PDSRegistry is AccessControl {
    bool public paused;

    address public beneficiaryRegistry;
    address public shopRegistry;
    address public warehouseRegistry;
    address public commodityRegistry;
    address public inventoryManager;
    address public entitlementManager;
    address public distributionManager;

    event ContractAddressUpdated(string indexed contractName, address indexed contractAddress);
    event PausedStateChanged(bool isPaused, address indexed admin);

    error SystemIsPaused();
    error SystemNotPaused();
    error ZeroAddressNotAllowed();

    modifier whenNotPaused() {
        if (paused) revert SystemIsPaused();
        _;
    }

    modifier whenPaused() {
        if (!paused) revert SystemNotPaused();
        _;
    }

    constructor() AccessControl() {
        paused = false;
    }

    function setPaused(bool _paused) external onlyAdmin {
        paused = _paused;
        emit PausedStateChanged(_paused, msg.sender);
    }

    function setBeneficiaryRegistry(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        beneficiaryRegistry = _addr;
        emit ContractAddressUpdated("BeneficiaryRegistry", _addr);
    }

    function setShopRegistry(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        shopRegistry = _addr;
        emit ContractAddressUpdated("ShopRegistry", _addr);
    }

    function setWarehouseRegistry(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        warehouseRegistry = _addr;
        emit ContractAddressUpdated("WarehouseRegistry", _addr);
    }

    function setCommodityRegistry(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        commodityRegistry = _addr;
        emit ContractAddressUpdated("CommodityRegistry", _addr);
    }

    function setInventoryManager(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        inventoryManager = _addr;
        emit ContractAddressUpdated("InventoryManager", _addr);
    }

    function setEntitlementManager(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        entitlementManager = _addr;
        emit ContractAddressUpdated("EntitlementManager", _addr);
    }

    function setDistributionManager(address _addr) external onlyAdmin {
        if (_addr == address(0)) revert ZeroAddressNotAllowed();
        distributionManager = _addr;
        emit ContractAddressUpdated("DistributionManager", _addr);
    }

    function getAllContractAddresses() external view returns (
        address _beneficiaryRegistry,
        address _shopRegistry,
        address _warehouseRegistry,
        address _commodityRegistry,
        address _inventoryManager,
        address _entitlementManager,
        address _distributionManager
    ) {
        return (
            beneficiaryRegistry,
            shopRegistry,
            warehouseRegistry,
            commodityRegistry,
            inventoryManager,
            entitlementManager,
            distributionManager
        );
    }
}

