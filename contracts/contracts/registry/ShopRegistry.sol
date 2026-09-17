// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";

/**
 * @title ShopRegistry
 * @notice Manages Fair Price Shops (FPS) authorized to distribute rations in PDSChain.
 */
contract ShopRegistry {
    PDSRegistry public immutable registry;

    struct FairPriceShop {
        string shopId;
        address operatorAddress;
        string district;
        bool isActive;
        uint256 registeredTimestamp;
    }

    mapping(string => FairPriceShop) private _shops;
    mapping(string => bool) private _exists;
    mapping(address => string) private _operatorToShopId;
    string[] private _shopIds;

    event ShopRegistered(string indexed shopId, address indexed operatorAddress, string district, address indexed registeredBy);
    event ShopStatusChanged(string indexed shopId, bool isActive, address indexed updatedBy);
    event ShopOperatorChanged(string indexed shopId, address indexed oldOperator, address indexed newOperator);

    error OnlyAdminAllowed();
    error ShopAlreadyExists(string shopId);
    error ShopNotFound(string shopId);
    error InvalidShopData();

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

    function registerShop(
        string calldata shopId,
        address operatorAddress,
        string calldata district
    ) external onlyAdmin {
        if (bytes(shopId).length == 0 || operatorAddress == address(0) || bytes(district).length == 0) {
            revert InvalidShopData();
        }
        if (_exists[shopId]) {
            revert ShopAlreadyExists(shopId);
        }

        _shops[shopId] = FairPriceShop({
            shopId: shopId,
            operatorAddress: operatorAddress,
            district: district,
            isActive: true,
            registeredTimestamp: block.timestamp
        });

        _exists[shopId] = true;
        _operatorToShopId[operatorAddress] = shopId;
        _shopIds.push(shopId);

        emit ShopRegistered(shopId, operatorAddress, district, msg.sender);
    }

    function setShopStatus(string calldata shopId, bool isActive) external onlyAdmin {
        if (!_exists[shopId]) {
            revert ShopNotFound(shopId);
        }

        _shops[shopId].isActive = isActive;
        emit ShopStatusChanged(shopId, isActive, msg.sender);
    }

    function setShopOperator(string calldata shopId, address newOperator) external onlyAdmin {
        if (!_exists[shopId]) {
            revert ShopNotFound(shopId);
        }
        if (newOperator == address(0)) {
            revert InvalidShopData();
        }

        address oldOperator = _shops[shopId].operatorAddress;
        _shops[shopId].operatorAddress = newOperator;
        _operatorToShopId[newOperator] = shopId;

        emit ShopOperatorChanged(shopId, oldOperator, newOperator);
    }

    function isShopActive(string calldata shopId) external view returns (bool) {
        if (!_exists[shopId]) return false;
        return _shops[shopId].isActive;
    }

    function isShopOperator(string calldata shopId, address operator) external view returns (bool) {
        if (!_exists[shopId]) return false;
        return _shops[shopId].operatorAddress == operator;
    }

    function getShop(string calldata shopId) external view returns (
        address operatorAddress,
        string memory district,
        bool isActive,
        uint256 registeredTimestamp
    ) {
        if (!_exists[shopId]) {
            revert ShopNotFound(shopId);
        }
        FairPriceShop storage s = _shops[shopId];
        return (s.operatorAddress, s.district, s.isActive, s.registeredTimestamp);
    }

    function getShopIdByOperator(address operator) external view returns (string memory) {
        return _operatorToShopId[operator];
    }

    function getShopCount() external view returns (uint256) {
        return _shopIds.length;
    }

    function getShopIdAtIndex(uint256 index) external view returns (string memory) {
        require(index < _shopIds.length, "Index out of bounds");
        return _shopIds[index];
    }
}
