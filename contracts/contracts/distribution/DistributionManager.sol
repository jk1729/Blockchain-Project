// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";
import "../registry/BeneficiaryRegistry.sol";
import "../registry/ShopRegistry.sol";
import "../registry/CommodityRegistry.sol";
import "../inventory/InventoryManager.sol";
import "../inventory/EntitlementManager.sol";

/**
 * @title DistributionManager
 * @notice Central orchestrator for grain ration distribution in PDSChain.
 * Atomically validates beneficiary eligibility, shop authorization, quota balance,
 * and shop physical inventory before executing state changes and generating receipts.
 */
contract DistributionManager {
    PDSRegistry public immutable registry;

    event RationDistributed(
        string indexed beneficiaryId,
        string indexed shopId,
        string indexed commodity,
        uint256 quantity,
        string period,
        address operator,
        bytes32 receiptHash,
        uint256 timestamp
    );

    error SystemPaused();
    error UnauthorizedOperator(string shopId, address operator);
    error InactiveShop(string shopId);
    error IneligibleBeneficiary(string beneficiaryId);
    error InvalidCommodity(string commodity);
    error InvalidQuantity();

    constructor(address _pdsRegistry) {
        require(_pdsRegistry != address(0), "Invalid PDSRegistry address");
        registry = PDSRegistry(_pdsRegistry);
    }

    function _verifyShop(string calldata shopId, address caller) internal view {
        ShopRegistry shopReg = ShopRegistry(registry.shopRegistry());
        if (!shopReg.isShopActive(shopId)) revert InactiveShop(shopId);

        bool isAdmin = registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), caller);
        bool isOperator = shopReg.isShopOperator(shopId, caller);
        if (!isAdmin && !isOperator) {
            revert UnauthorizedOperator(shopId, caller);
        }
    }

    function _verifyBeneficiaryAndCommodity(string calldata beneficiaryId, string calldata commodity) internal view {
        BeneficiaryRegistry benReg = BeneficiaryRegistry(registry.beneficiaryRegistry());
        if (!benReg.isEligible(beneficiaryId)) revert IneligibleBeneficiary(beneficiaryId);

        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);
    }

    /**
     * @notice Execute grain ration distribution
     * @param beneficiaryId Pseudonymous beneficiary ID
     * @param shopId Fair Price Shop ID
     * @param commodity Name of commodity (e.g. "Rice")
     * @param quantity Amount to distribute (e.g. 10)
     * @param period Period string (e.g. "2026-09")
     * @return success True if distribution executed successfully
     * @return receiptHash Cryptographic receipt hash of the distribution
     */
    function distributeRation(
        string calldata beneficiaryId,
        string calldata shopId,
        string calldata commodity,
        uint256 quantity,
        string calldata period
    ) external returns (bool success, bytes32 receiptHash) {
        if (registry.paused()) revert SystemPaused();
        if (quantity == 0) revert InvalidQuantity();

        _verifyShop(shopId, msg.sender);
        _verifyBeneficiaryAndCommodity(beneficiaryId, commodity);

        // Consume Entitlement Quota
        EntitlementManager(registry.entitlementManager()).consumeEntitlement(
            beneficiaryId,
            period,
            commodity,
            quantity
        );

        // Deduct Shop Inventory
        InventoryManager(registry.inventoryManager()).deductShopStock(
            shopId,
            commodity,
            quantity
        );

        // Generate Deterministic Distribution Receipt Hash
        receiptHash = keccak256(
            abi.encodePacked(
                beneficiaryId,
                shopId,
                commodity,
                quantity,
                period,
                block.timestamp,
                msg.sender
            )
        );

        emit RationDistributed(
            beneficiaryId,
            shopId,
            commodity,
            quantity,
            period,
            msg.sender,
            receiptHash,
            block.timestamp
        );

        return (true, receiptHash);
    }
}

