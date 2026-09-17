// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";
import "../registry/BeneficiaryRegistry.sol";
import "../registry/CommodityRegistry.sol";

/**
 * @title EntitlementManager
 * @notice Computes, allocates, and tracks monthly grain entitlement quotas per citizen beneficiary.
 * Enforces period-based claim limits (e.g., calendar month "YYYY-MM") and prevents double claiming.
 */
contract EntitlementManager {
    PDSRegistry public immutable registry;

    // category => commodity => defaultQuota
    mapping(string => mapping(string => uint256)) private _categoryQuota;

    // beneficiaryId => commodity => customQuota
    mapping(string => mapping(string => uint256)) private _customQuota;

    // beneficiaryId => period (e.g. "2026-09") => commodity => claimedAmount
    mapping(string => mapping(string => mapping(string => uint256))) private _claimed;

    event CategoryQuotaSet(string indexed category, string indexed commodity, uint256 quota, address indexed by);
    event BeneficiaryQuotaSet(string indexed beneficiaryId, string indexed commodity, uint256 quota, address indexed by);
    event EntitlementConsumed(string indexed beneficiaryId, string period, string indexed commodity, uint256 amount, address indexed by);

    error OnlyAdminAllowed();
    error OnlyDistributionManagerAllowed();
    error IneligibleBeneficiary(string beneficiaryId);
    error InvalidCommodity(string commodity);
    error QuotaExceeded(string beneficiaryId, string period, string commodity, uint256 remaining, uint256 requested);
    error InvalidAmount();

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

    function setCategoryQuota(
        string calldata category,
        string calldata commodity,
        uint256 quota
    ) external onlyAdmin {
        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);

        _categoryQuota[category][commodity] = quota;
        emit CategoryQuotaSet(category, commodity, quota, msg.sender);
    }

    function setBeneficiaryQuota(
        string calldata beneficiaryId,
        string calldata commodity,
        uint256 quota
    ) external onlyAdmin {
        BeneficiaryRegistry benReg = BeneficiaryRegistry(registry.beneficiaryRegistry());
        if (!benReg.isEligible(beneficiaryId)) revert IneligibleBeneficiary(beneficiaryId);

        CommodityRegistry comReg = CommodityRegistry(registry.commodityRegistry());
        if (!comReg.isValidCommodity(commodity)) revert InvalidCommodity(commodity);

        _customQuota[beneficiaryId][commodity] = quota;
        emit BeneficiaryQuotaSet(beneficiaryId, commodity, quota, msg.sender);
    }

    function getMonthlyQuota(string calldata beneficiaryId, string calldata commodity) public view returns (uint256) {
        // 1. Check custom quota if specified
        uint256 custom = _customQuota[beneficiaryId][commodity];
        if (custom > 0) return custom;

        // 2. Fall back to category quota
        BeneficiaryRegistry benReg = BeneficiaryRegistry(registry.beneficiaryRegistry());
        (string memory category, , , ) = benReg.getBeneficiary(beneficiaryId);
        return _categoryQuota[category][commodity];
    }

    function getClaimed(
        string calldata beneficiaryId,
        string calldata period,
        string calldata commodity
    ) public view returns (uint256) {
        return _claimed[beneficiaryId][period][commodity];
    }

    function getRemainingQuota(
        string calldata beneficiaryId,
        string calldata period,
        string calldata commodity
    ) public view returns (uint256) {
        uint256 quota = getMonthlyQuota(beneficiaryId, commodity);
        uint256 alreadyClaimed = getClaimed(beneficiaryId, period, commodity);
        if (alreadyClaimed >= quota) {
            return 0;
        }
        return quota - alreadyClaimed;
    }

    function consumeEntitlement(
        string calldata beneficiaryId,
        string calldata period,
        string calldata commodity,
        uint256 amount
    ) external onlyDistributionManager {
        if (amount == 0) revert InvalidAmount();

        uint256 remaining = getRemainingQuota(beneficiaryId, period, commodity);
        if (remaining < amount) {
            revert QuotaExceeded(beneficiaryId, period, commodity, remaining, amount);
        }

        _claimed[beneficiaryId][period][commodity] += amount;
        emit EntitlementConsumed(beneficiaryId, period, commodity, amount, msg.sender);
    }
}
