// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

interface IIdentityResolver {
    function identityOfWallet(address wallet) external view returns (address);
}

/**
 * @title GatedERC20  (transfer-gate surface)
 * @notice A permissioned ERC-20 whose _update consults the EligibilityGate. The 4th
 *         enforcement surface: the "transfer fails" of the money moment.
 *
 * Free-exit principle (unifies with the Uniswap hook):
 *   - mint (from == 0):   recipient `to` must be eligible
 *   - transfer:           BOTH `from` AND `to` must be eligible  (revoke -> your transfer fails)
 *   - burn (to == 0):     NO gate -- you can always exit/redeem, we never trap funds
 *
 * "Compliance blocks movement to a counterparty (transfer/swap), never your own exit (burn)."
 */
contract GatedERC20 is ERC20 {
    IEligibilityGate public immutable gate;
    IIdentityResolver public immutable resolver; // wallet -> identity
    uint256 public immutable policyId; // e.g. requires KYC_VERIFIED

    error NotEligible(address wallet, bytes32 reason);

    constructor(string memory name_, string memory symbol_, address gate_, address resolver_, uint256 policyId_)
        ERC20(name_, symbol_)
    {
        gate = IEligibilityGate(gate_);
        resolver = IIdentityResolver(resolver_);
        policyId = policyId_;
    }

    /// @notice Demo mint. In production this is gated to an issuer/agent role.
    function mint(address to, uint256 amt) public {
        _mint(to, amt);
    }

    function _update(address from, address to, uint256 value) internal override {
        bool isMint = from == address(0);
        bool isBurn = to == address(0);

        // real transfer (not mint, not burn): sender must be eligible -> "transfer fails" on revocation
        if (!isMint && !isBurn) _requireEligible(from);
        // mint or transfer: recipient must be eligible (parity with isVerified(to))
        if (!isBurn) _requireEligible(to);
        // burn (to == 0): NO check -> exit/redeem always free

        super._update(from, to, value);
    }

    function _requireEligible(address wallet) internal view {
        address identity = resolver.identityOfWallet(wallet);
        (bool ok, bytes32 reason) = gate.isEligible(identity, policyId);
        if (!ok) revert NotEligible(wallet, reason);
    }
}
