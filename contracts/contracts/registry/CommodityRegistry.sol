// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";

/**
 * @title CommodityRegistry
 * @notice Manages authorized PDS food grain commodities (Rice, Wheat, Sugar, etc.) and units.
 */
contract CommodityRegistry {
    PDSRegistry public immutable registry;

    struct Commodity {
        string name;
        string unit; // e.g. "KG", "L"
        bool isActive;
    }

    mapping(string => Commodity) private _commodities;
    mapping(string => bool) private _exists;
    string[] private _commodityNames;

    event CommodityRegistered(string indexed name, string unit, address indexed registeredBy);
    event CommodityStatusChanged(string indexed name, bool isActive, address indexed updatedBy);

    error OnlyAdminAllowed();
    error CommodityAlreadyExists(string name);
    error CommodityNotFound(string name);
    error InvalidCommodityData();

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

    function registerCommodity(string calldata name, string calldata unit) external onlyAdmin {
        if (bytes(name).length == 0 || bytes(unit).length == 0) {
            revert InvalidCommodityData();
        }
        if (_exists[name]) {
            revert CommodityAlreadyExists(name);
        }

        _commodities[name] = Commodity({
            name: name,
            unit: unit,
            isActive: true
        });

        _exists[name] = true;
        _commodityNames.push(name);

        emit CommodityRegistered(name, unit, msg.sender);
    }

    function setCommodityStatus(string calldata name, bool isActive) external onlyAdmin {
        if (!_exists[name]) {
            revert CommodityNotFound(name);
        }

        _commodities[name].isActive = isActive;
        emit CommodityStatusChanged(name, isActive, msg.sender);
    }

    function isValidCommodity(string calldata name) external view returns (bool) {
        if (!_exists[name]) return false;
        return _commodities[name].isActive;
    }

    function getCommodity(string calldata name) external view returns (
        string memory unit,
        bool isActive
    ) {
        if (!_exists[name]) {
            revert CommodityNotFound(name);
        }
        Commodity storage c = _commodities[name];
        return (c.unit, c.isActive);
    }

    function getCommodityCount() external view returns (uint256) {
        return _commodityNames.length;
    }

    function getCommodityNameAtIndex(uint256 index) external view returns (string memory) {
        require(index < _commodityNames.length, "Index out of bounds");
        return _commodityNames[index];
    }
}

