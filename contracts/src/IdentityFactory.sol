// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Identity} from "./Identity.sol";

/**
 * @title IdentityFactory
 * @notice Creates one Identity per wallet and resolves wallet → identity.
 *         `identityOfWallet` is what the token + hook use to find a wallet's identity.
 *
 * For the MVP the backend (AGENT_ROLE) creates the identity after Privy login + proof of wallet
 * ownership off-chain. The wallet becomes the MANAGEMENT key of its own identity.
 */
contract IdentityFactory is AccessControl {
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    address public immutable issuerRegistry;
    mapping(address => address) public identityOfWallet; // wallet => identity

    event IdentityCreated(address indexed wallet, address indexed identity);

    error ZeroAdmin();
    error ZeroIssuerRegistry();
    error ZeroWallet();
    error IdentityExists();

    constructor(address admin, address issuerRegistry_) {
        if (admin == address(0)) revert ZeroAdmin();
        if (issuerRegistry_ == address(0)) revert ZeroIssuerRegistry();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);
        issuerRegistry = issuerRegistry_;
    }

    function createIdentity(address wallet) external onlyRole(AGENT_ROLE) returns (address identity) {
        if (wallet == address(0)) revert ZeroWallet();
        if (identityOfWallet[wallet] != address(0)) revert IdentityExists();
        identity = address(new Identity(wallet, issuerRegistry));
        identityOfWallet[wallet] = identity;
        emit IdentityCreated(wallet, identity);
    }
}
