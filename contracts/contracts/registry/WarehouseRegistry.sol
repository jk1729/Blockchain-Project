// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";

/**
 * @title WarehouseRegistry
 * @notice Manages grain storage depots and warehouses in PDSChain.
 */
contract WarehouseRegistry {
    PDSRegistry public immutable registry;

    struct Warehouse {
        string warehouseId;
        address managerAddress;
        uint256 capacity; // in standard units (e.g., metric tons / KG)
        bool isActive;
        uint256 registeredTimestamp;
    }

    mapping(string => Warehouse) private _warehouses;
    mapping(string => bool) private _exists;
    string[] private _warehouseIds;

    event WarehouseRegistered(string indexed warehouseId, address indexed managerAddress, uint256 capacity, address indexed registeredBy);
    event WarehouseStatusChanged(string indexed warehouseId, bool isActive, address indexed updatedBy);
    event WarehouseManagerChanged(string indexed warehouseId, address indexed oldManager, address indexed newManager);

    error OnlyAdminAllowed();
    error WarehouseAlreadyExists(string warehouseId);
    error WarehouseNotFound(string warehouseId);
    error InvalidWarehouseData();

    modifier onlyAdmin() {
        if (!registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender)) {
            revert OnlyAdminAllowed();
        }
        _;
    }

    constructor(address _pdsRegistry) {
        require(_pdsRegistry != address(0), "Invalid PDSRegistry address");
        registry = PDSRegistry(_pdsRegistry);
    }

    function registerWarehouse(
        string calldata warehouseId,
        address managerAddress,
        uint256 capacity
    ) external onlyAdmin {
        if (bytes(warehouseId).length == 0 || managerAddress == address(0) || capacity == 0) {
            revert InvalidWarehouseData();
        }
        if (_exists[warehouseId]) {
            revert WarehouseAlreadyExists(warehouseId);
        }

        _warehouses[warehouseId] = Warehouse({
            warehouseId: warehouseId,
            managerAddress: managerAddress,
            capacity: capacity,
            isActive: true,
            registeredTimestamp: block.timestamp
        });

        _exists[warehouseId] = true;
        _warehouseIds.push(warehouseId);

        emit WarehouseRegistered(warehouseId, managerAddress, capacity, msg.sender);
    }

    function setWarehouseStatus(string calldata warehouseId, bool isActive) external onlyAdmin {
        if (!_exists[warehouseId]) {
            revert WarehouseNotFound(warehouseId);
        }

        _warehouses[warehouseId].isActive = isActive;
        emit WarehouseStatusChanged(warehouseId, isActive, msg.sender);
    }

    function setWarehouseManager(string calldata warehouseId, address newManager) external onlyAdmin {
        if (!_exists[warehouseId]) {
            revert WarehouseNotFound(warehouseId);
        }
        if (newManager == address(0)) {
            revert InvalidWarehouseData();
        }

        address oldManager = _warehouses[warehouseId].managerAddress;
        _warehouses[warehouseId].managerAddress = newManager;

        emit WarehouseManagerChanged(warehouseId, oldManager, newManager);
    }

    function isWarehouseActive(string calldata warehouseId) external view returns (bool) {
        if (!_exists[warehouseId]) return false;
        return _warehouses[warehouseId].isActive;
    }

    function isWarehouseManager(string calldata warehouseId, address manager) external view returns (bool) {
        if (!_exists[warehouseId]) return false;
        return _warehouses[warehouseId].managerAddress == manager;
    }

    function getWarehouse(string calldata warehouseId) external view returns (
        address managerAddress,
        uint256 capacity,
        bool isActive,
        uint256 registeredTimestamp
    ) {
        if (!_exists[warehouseId]) {
            revert WarehouseNotFound(warehouseId);
        }
        Warehouse storage w = _warehouses[warehouseId];
        return (w.managerAddress, w.capacity, w.isActive, w.registeredTimestamp);
    }

    function getWarehouseCount() external view returns (uint256) {
        return _warehouseIds.length;
    }
}
