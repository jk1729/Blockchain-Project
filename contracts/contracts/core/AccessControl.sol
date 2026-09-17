// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title AccessControl
 * @notice Role-Based Access Control (RBAC) contract for institutional actors in PDSChain.
 * Provides explicit roles: DEFAULT_ADMIN_ROLE, SHOP_ROLE, WAREHOUSE_ROLE, VALIDATOR_ROLE, INSPECTOR_ROLE.
 */
abstract contract AccessControl {
    bytes32 public constant DEFAULT_ADMIN_ROLE = 0x00;
    bytes32 public constant SHOP_ROLE = keccak256("SHOP_ROLE");
    bytes32 public constant WAREHOUSE_ROLE = keccak256("WAREHOUSE_ROLE");
    bytes32 public constant VALIDATOR_ROLE = keccak256("VALIDATOR_ROLE");
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");

    mapping(bytes32 => mapping(address => bool)) private _roles;

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    error UnauthorizedRole(bytes32 role, address account);

    constructor() {
        _roles[DEFAULT_ADMIN_ROLE][msg.sender] = true;
        emit RoleGranted(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
    }

    modifier onlyRole(bytes32 role) {
        if (!hasRole(role, msg.sender)) {
            revert UnauthorizedRole(role, msg.sender);
        }
        _;
    }

    modifier onlyAdmin() {
        if (!hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert UnauthorizedRole(DEFAULT_ADMIN_ROLE, msg.sender);
        }
        _;
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) public onlyAdmin {
        require(account != address(0), "Invalid account address");
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revokeRole(bytes32 role, address account) public onlyAdmin {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }
}

