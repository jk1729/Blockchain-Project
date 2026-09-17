// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "../core/PDSRegistry.sol";

/**
 * @title BeneficiaryRegistry
 * @notice Manages pseudonymous citizen beneficiary eligibility for PDS rations.
 * Strictly adheres to privacy requirements: Zero Aadhaar numbers or personal PII stored on-chain.
 */
contract BeneficiaryRegistry {
    PDSRegistry public immutable registry;

    struct Beneficiary {
        string beneficiaryId;
        string category; // e.g., "AAY", "PHH", "BPL", "APL"
        uint256 familySize;
        bool isActive;
        uint256 registeredTimestamp;
    }

    mapping(string => Beneficiary) private _beneficiaries;
    mapping(string => bool) private _exists;
    string[] private _beneficiaryIds;

    event BeneficiaryRegistered(string indexed beneficiaryId, string category, uint256 familySize, address indexed registeredBy);
    event BeneficiaryStatusChanged(string indexed beneficiaryId, bool isActive, address indexed updatedBy);

    error OnlyAdminOrInspectorAllowed();
    error BeneficiaryAlreadyExists(string beneficiaryId);
    error BeneficiaryNotFound(string beneficiaryId);
    error InvalidBeneficiaryData();

    modifier onlyAuthorized() {
        if (!registry.hasRole(registry.DEFAULT_ADMIN_ROLE(), msg.sender) &&
            !registry.hasRole(registry.INSPECTOR_ROLE(), msg.sender)) {
            revert OnlyAdminOrInspectorAllowed();
        }
        _;
    }

    constructor(address _pdsRegistry) {
        require(_pdsRegistry != address(0), "Invalid PDSRegistry address");
        registry = PDSRegistry(_pdsRegistry);
    }

    function registerBeneficiary(
        string calldata beneficiaryId,
        string calldata category,
        uint256 familySize
    ) external onlyAuthorized {
        if (bytes(beneficiaryId).length == 0 || bytes(category).length == 0 || familySize == 0) {
            revert InvalidBeneficiaryData();
        }
        if (_exists[beneficiaryId]) {
            revert BeneficiaryAlreadyExists(beneficiaryId);
        }

        _beneficiaries[beneficiaryId] = Beneficiary({
            beneficiaryId: beneficiaryId,
            category: category,
            familySize: familySize,
            isActive: true,
            registeredTimestamp: block.timestamp
        });

        _exists[beneficiaryId] = true;
        _beneficiaryIds.push(beneficiaryId);

        emit BeneficiaryRegistered(beneficiaryId, category, familySize, msg.sender);
    }

    function setBeneficiaryStatus(string calldata beneficiaryId, bool isActive) external onlyAuthorized {
        if (!_exists[beneficiaryId]) {
            revert BeneficiaryNotFound(beneficiaryId);
        }

        _beneficiaries[beneficiaryId].isActive = isActive;
        emit BeneficiaryStatusChanged(beneficiaryId, isActive, msg.sender);
    }

    function isEligible(string calldata beneficiaryId) external view returns (bool) {
        if (!_exists[beneficiaryId]) return false;
        return _beneficiaries[beneficiaryId].isActive;
    }

    function getBeneficiary(string calldata beneficiaryId) external view returns (
        string memory category,
        uint256 familySize,
        bool isActive,
        uint256 registeredTimestamp
    ) {
        if (!_exists[beneficiaryId]) {
            revert BeneficiaryNotFound(beneficiaryId);
        }
        Beneficiary storage b = _beneficiaries[beneficiaryId];
        return (b.category, b.familySize, b.isActive, b.registeredTimestamp);
    }

    function getBeneficiaryCount() external view returns (uint256) {
        return _beneficiaryIds.length;
    }

    function getBeneficiaryIdAtIndex(uint256 index) external view returns (string memory) {
        require(index < _beneficiaryIds.length, "Index out of bounds");
        return _beneficiaryIds[index];
    }
}

