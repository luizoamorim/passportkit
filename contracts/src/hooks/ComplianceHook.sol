// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

import {Reason} from "../libraries/Types.sol";

/// Minimal view of the decision core — the hook adds zero eligibility logic of its own.
interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool ok, bytes32 reason);
}

/// Minimal view of the IdentityFactory: wallet (person OR agent) -> Identity contract.
interface IIdentityResolver {
    function identityOfWallet(address wallet) external view returns (address);
}

/**
 * @title ComplianceHook
 * @notice Uniswap v4 hook that turns a pool into a compliance-gated venue.
 *
 * Surface #4 of PassportKit: the same EligibilityGate that guards the token, the ENS
 * name and the Deal Room guards the pool. Swaps and liquidity additions are only
 * allowed for wallets whose identity satisfies this pool's `policyId`; removing
 * liquidity is deliberately ungated — funds are never trapped when compliance lapses.
 * The single exception is `bootstrapLp`, which may seed an EMPTY pool and nothing else
 * (see the field docs) — swaps are never exempt.
 *
 * Decision AND diagnosis come from the gate:
 *   - `isEligible(identity, policyId)` is the only access decision (no local rules).
 *   - the `reason` it returns (MISSING_KYC, MISSING_ACCREDITED, NO_POLICY, …) is what
 *     the revert carries, so the pool never disagrees with the rest of the system.
 *   - the one code the hook owns is NO_IDENTITY, for a wallet the resolver doesn't know.
 *
 * A pool's policy is just the immutable `policyId`; which topics that requires lives in
 * the gate (`EligibilityGate.setPolicy`). Repo-wide: policy 1 = Deal Room (KYC),
 * policy 2 = Investor (KYC + accredited).
 *
 * Actor resolution: v4 passes the router as `sender`, so the trading wallet arrives
 * as a 32-byte address in hookData. Empty hookData falls back to `sender`.
 * ⚠ hookData is self-declared — hackathon assumption of a trusted periphery.
 * Roadmap: bind the actor by signature or restrict to an allowlisted router.
 */
contract ComplianceHook is BaseHook {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    error NotCompliant(address wallet, bytes32 reasonCode);

    IEligibilityGate public immutable gate;
    IIdentityResolver public immutable resolver; // wallet -> identity
    uint256 public immutable policyId;

    /**
     * @notice The one address allowed to seed an EMPTY pool without passing the policy.
     * @dev A gated pool has a bootstrap problem: `beforeAddLiquidity` consults the gate, so
     *      the very first LP must already be compliant — but on a fresh deployment nobody
     *      is, and an empty pool cannot demonstrate anything. This is the narrowest fix:
     *
     *        - ONE address, fixed at construction and immutable: no admin, no setter,
     *          nothing to seize later. It is visible in the verified source.
     *        - it applies to `beforeAddLiquidity` ONLY. Swaps are NEVER exempt, so the
     *          pool operator can seed the pool and still be refused when it tries to trade.
     *        - it CLOSES as soon as the pool holds liquidity. Not "this address may always
     *          add", but "this address may open an empty pool" — a one-shot that expires by
     *          itself, so unverified capital cannot be added alongside verified capital.
     *
     *      address(0) disables it entirely (and is checked explicitly, so hookData that
     *      declares address(0) as the actor can never be mistaken for the bootstrap LP).
     */
    address public immutable bootstrapLp;

    constructor(
        IPoolManager poolManager,
        IEligibilityGate gate_,
        IIdentityResolver resolver_,
        uint256 policyId_,
        address bootstrapLp_
    ) BaseHook(poolManager) {
        gate = gate_;
        resolver = resolver_;
        policyId = policyId_;
        bootstrapLp = bootstrapLp_;
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
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) internal view override returns (bytes4) {
        address actor = _actor(sender, hookData);
        if (!isBootstrapping(key, actor)) _requireCompliant(actor);
        return BaseHook.beforeAddLiquidity.selector;
    }

    /**
     * @notice Whether `wallet` may add liquidity to `key` without passing the policy.
     * @dev True only for the immutable bootstrap LP, and only while the pool is empty.
     */
    function isBootstrapping(PoolKey calldata key, address wallet) public view returns (bool) {
        if (bootstrapLp == address(0) || wallet != bootstrapLp) return false;
        return poolManager.getLiquidity(key.toId()) == 0;
    }

    /**
     * @notice Why a wallet fails this pool's policy — the exact code its revert carries.
     * @return reasonCode the gate's own reason code, NO_IDENTITY for an unknown wallet,
     *         or bytes32(0) when the wallet is compliant.
     */
    function reasonFor(address wallet) public view returns (bytes32) {
        address identity = resolver.identityOfWallet(wallet);
        if (identity == address(0)) return Reason.NO_IDENTITY;
        (, bytes32 reason) = gate.isEligible(identity, policyId);
        return reason;
    }

    // --- Internal ---

    /// @dev Mirrors reasonFor() with a single gate call — same decision, same code.
    function _requireCompliant(address wallet) internal view {
        address identity = resolver.identityOfWallet(wallet);
        if (identity == address(0)) revert NotCompliant(wallet, Reason.NO_IDENTITY);
        (bool ok, bytes32 reason) = gate.isEligible(identity, policyId);
        if (!ok) revert NotCompliant(wallet, reason);
    }

    function _actor(address sender, bytes calldata hookData) internal pure returns (address) {
        return hookData.length == 32 ? abi.decode(hookData, (address)) : sender;
    }
}
