// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {IAccessGate} from "../interfaces/IAccessGate.sol";
import {IClaimRegistry} from "../interfaces/IClaimRegistry.sol";
import {ICompliancePassport} from "../interfaces/ICompliancePassport.sol";

/**
 * @title ComplianceHook
 * @notice Uniswap v4 hook that turns a pool into a compliance-gated venue.
 *
 * Surface #4 of PassportCreds: the same AccessGate that guards the Deal Room guards
 * the pool. Swaps and liquidity additions are only allowed for wallets that pass the
 * configured policy; removing liquidity is deliberately ungated — funds are never
 * trapped when compliance lapses.
 *
 * Decision vs. diagnosis:
 *   - The AccessGate boolean is the only access decision (zero new eligibility logic).
 *   - reasonFor() derives a human-readable reason code from ClaimRegistry and
 *     CompliancePassport purely for the revert / UI. Advisory only.
 *
 * Actor resolution: v4 passes the router as `sender`, so the trading wallet arrives
 * as a 32-byte address in hookData. Empty hookData falls back to `sender`.
 * ⚠ hookData is self-declared — hackathon assumption of a trusted periphery.
 * Roadmap: bind the actor by signature or restrict to an allowlisted router.
 */
contract ComplianceHook is BaseHook {
    /// Which AccessGate question this pool asks.
    ///   DEAL_ROOM     — canAccessDealRoom: valid KYC/AML claim + LIMITED or GREEN passport.
    ///   INVESTOR_AREA — canAccessInvestorArea: both claims valid + GREEN passport.
    enum Policy {
        DEAL_ROOM,
        INVESTOR_AREA
    }

    error NotCompliant(address wallet, bytes32 reasonCode);

    IAccessGate public immutable ACCESS_GATE;
    IClaimRegistry public immutable CLAIM_REGISTRY;
    ICompliancePassport public immutable COMPLIANCE_PASSPORT;
    Policy public immutable POLICY;

    bytes32 private constant KYC_AML_VERIFIED = keccak256("KYC_AML_VERIFIED");
    bytes32 private constant ACCREDITED_INVESTOR = keccak256("ACCREDITED_INVESTOR");

    constructor(
        IPoolManager poolManager,
        IAccessGate accessGate,
        IClaimRegistry claimRegistry,
        ICompliancePassport compliancePassport,
        Policy policy
    ) BaseHook(poolManager) {
        ACCESS_GATE = accessGate;
        CLAIM_REGISTRY = claimRegistry;
        COMPLIANCE_PASSPORT = compliancePassport;
        POLICY = policy;
    }

    /**
     * @notice v4 permissions — encoded in the deployed hook address.
     * @dev beforeRemoveLiquidity is intentionally false: exit is always free.
     */
    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: true,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    function _beforeSwap(address sender, PoolKey calldata, SwapParams calldata, bytes calldata hookData)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireCompliant(_actor(sender, hookData));
        return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _beforeAddLiquidity(
        address sender,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) internal view override returns (bytes4) {
        _requireCompliant(_actor(sender, hookData));
        return BaseHook.beforeAddLiquidity.selector;
    }

    /**
     * @notice Advisory diagnosis of why a wallet fails this pool's policy.
     * @return reasonCode bytes32 short string, or bytes32(0) when compliant.
     */
    function reasonFor(address wallet) public view returns (bytes32) {
        if (_allowed(wallet)) return bytes32(0);

        if (COMPLIANCE_PASSPORT.statusOf(wallet) == ICompliancePassport.PassportStatus.REVOKED) {
            return "PASSPORT_REVOKED";
        }

        IClaimRegistry.Claim memory kyc = CLAIM_REGISTRY.getClaim(wallet, KYC_AML_VERIFIED);
        if (
            kyc.status == IClaimRegistry.ClaimStatus.FAILED
                || kyc.status == IClaimRegistry.ClaimStatus.REVOKED
        ) {
            return "KYC_FAILED";
        }
        if (!CLAIM_REGISTRY.hasValidClaim(wallet, KYC_AML_VERIFIED)) {
            return kyc.status == IClaimRegistry.ClaimStatus.VERIFIED
                ? bytes32("KYC_EXPIRED")
                : bytes32("KYC_MISSING");
        }

        if (POLICY == Policy.INVESTOR_AREA) {
            IClaimRegistry.Claim memory accredited = CLAIM_REGISTRY.getClaim(wallet, ACCREDITED_INVESTOR);
            if (!CLAIM_REGISTRY.hasValidClaim(wallet, ACCREDITED_INVESTOR)) {
                return accredited.status == IClaimRegistry.ClaimStatus.VERIFIED
                    ? bytes32("ACCREDITATION_EXPIRED")
                    : bytes32("ACCREDITATION_MISSING");
            }
        }

        // Valid claims but the stored passport status lags behind (no syncPassport yet)
        return "PASSPORT_OUT_OF_SYNC";
    }

    // --- Internal ---

    function _requireCompliant(address wallet) internal view {
        if (!_allowed(wallet)) revert NotCompliant(wallet, reasonFor(wallet));
    }

    function _allowed(address wallet) internal view returns (bool) {
        return POLICY == Policy.DEAL_ROOM
            ? ACCESS_GATE.canAccessDealRoom(wallet)
            : ACCESS_GATE.canAccessInvestorArea(wallet);
    }

    function _actor(address sender, bytes calldata hookData) internal pure returns (address) {
        return hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
    }
}
