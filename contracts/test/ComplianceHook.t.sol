// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager, SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {AccessGate} from "../src/AccessGate.sol";
import {ComplianceHook} from "../src/hooks/ComplianceHook.sol";

/**
 * Integration tests: ComplianceHook against the real PassportCreds stack
 * (ClaimRegistry + CompliancePassport + AccessGate), on a real v4 PoolManager.
 *
 * Two pools:
 *   dealPool     — hook policy DEAL_ROOM      (LIMITED or GREEN passport)
 *   investorPool — hook policy INVESTOR_AREA  (GREEN passport only)
 */
contract ComplianceHookTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    PoolModifyLiquidityTest liquidityRouter;

    MockERC20 token0;
    MockERC20 token1;

    ComplianceHook dealHook;
    ComplianceHook investorHook;
    PoolKey dealPool;
    PoolKey investorPool;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address ana = makeAddr("ana"); // gets verified during tests
    address rui = makeAddr("rui"); // never verified

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    bytes32 constant ACCREDITED = keccak256("ACCREDITED_INVESTOR");
    bytes32 constant ATTEST = keccak256("attest");
    uint64 FUTURE;
    uint256 nonce;

    int24 tickLower;
    int24 tickUpper;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);

        // --- PassportCreds stack (the real contracts) ---
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));

        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();

        // The test contract acts as LP and must be GREEN to enter both pools
        _verify(address(this), KYC, true, FUTURE);
        _verify(address(this), ACCREDITED, true, FUTURE);

        // --- Uniswap v4 stack ---
        poolManager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new PoolModifyLiquidityTest(poolManager);

        MockERC20 tokenA = new MockERC20("Deal Token", "DEAL", 18);
        MockERC20 tokenB = new MockERC20("Quote Token", "QUOTE", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        token0.mint(address(this), 10_000 ether);
        token1.mint(address(this), 10_000 ether);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);

        // Hook addresses must encode the permissions; deployCodeTo skips mining in tests
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        dealHook = ComplianceHook(address(flags ^ (0x4444 << 144)));
        investorHook = ComplianceHook(address(flags ^ (0x4445 << 144)));
        deployCodeTo(
            "ComplianceHook.sol:ComplianceHook",
            abi.encode(poolManager, gate, registry, passport, ComplianceHook.Policy.DEAL_ROOM),
            address(dealHook)
        );
        deployCodeTo(
            "ComplianceHook.sol:ComplianceHook",
            abi.encode(poolManager, gate, registry, passport, ComplianceHook.Policy.INVESTOR_AREA),
            address(investorHook)
        );

        dealPool = _createPool(dealHook);
        investorPool = _createPool(investorHook);
    }

    // --- helpers ---

    function _createPool(ComplianceHook hook) internal returns (PoolKey memory key) {
        key = PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(hook))
        );
        poolManager.initialize(key, SQRT_PRICE_1_1);

        tickLower = TickMath.minUsableTick(60);
        tickUpper = TickMath.maxUsableTick(60);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1_000e18,
                salt: 0
            }),
            abi.encode(address(this))
        );
    }

    function _verify(address user, bytes32 claimType, bool approved, uint64 expiresAt) internal {
        vm.startPrank(updater);
        registry.submitClaim(user, claimType, approved, keccak256(abi.encode(nonce++)), ATTEST, expiresAt);
        passport.syncPassport(user);
        vm.stopPrank();
    }

    function _swap(PoolKey memory key, bytes memory hookData) internal {
        swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: true,
                amountSpecified: -1e18,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            hookData
        );
    }

    function _addLiquidity(PoolKey memory key, bytes memory hookData) internal {
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: 1e18,
                salt: 0
            }),
            hookData
        );
    }

    function _expectNotCompliant(ComplianceHook hook, bytes4 hookFn, address wallet, bytes32 reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookFn,
                abi.encodeWithSelector(ComplianceHook.NotCompliant.selector, wallet, reason),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    // --- swap gating ---

    function test_swap_blocked_when_never_verified() public {
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, rui, "KYC_MISSING");
        _swap(dealPool, abi.encode(rui));
    }

    function test_swap_allowed_after_kyc_verification() public {
        _verify(ana, KYC, true, FUTURE);

        uint256 balanceBefore = token1.balanceOf(address(this));
        _swap(dealPool, abi.encode(ana));
        assertGt(token1.balanceOf(address(this)), balanceBefore);
    }

    function test_swap_blocked_when_kyc_failed() public {
        _verify(rui, KYC, false, FUTURE);
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, rui, "KYC_FAILED");
        _swap(dealPool, abi.encode(rui));
    }

    function test_swap_blocked_when_kyc_expired() public {
        _verify(ana, KYC, true, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 31 days);

        // passport still says LIMITED (stale), but the gate checks the live claim
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "KYC_EXPIRED");
        _swap(dealPool, abi.encode(ana));
    }

    function test_swap_blocked_when_passport_revoked() public {
        _verify(ana, KYC, true, FUTURE);
        vm.prank(admin);
        passport.revokePassport(ana);

        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "PASSPORT_REVOKED");
        _swap(dealPool, abi.encode(ana));
    }

    function test_swap_blocked_when_claim_submitted_but_never_synced() public {
        // claim is valid but no passport was minted — the gate decides, not the claim alone
        vm.prank(updater);
        registry.submitClaim(ana, KYC, true, keccak256(abi.encode(nonce++)), ATTEST, FUTURE);

        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, ana, "PASSPORT_OUT_OF_SYNC");
        _swap(dealPool, abi.encode(ana));
    }

    // --- investor pool policy ---

    function test_investor_pool_blocked_when_limited() public {
        _verify(ana, KYC, true, FUTURE);
        _expectNotCompliant(investorHook, IHooks.beforeSwap.selector, ana, "ACCREDITATION_MISSING");
        _swap(investorPool, abi.encode(ana));
    }

    function test_investor_pool_allowed_when_green() public {
        _verify(ana, KYC, true, FUTURE);
        _verify(ana, ACCREDITED, true, FUTURE);

        uint256 balanceBefore = token1.balanceOf(address(this));
        _swap(investorPool, abi.encode(ana));
        assertGt(token1.balanceOf(address(this)), balanceBefore);
    }

    function test_investor_pool_blocked_when_accreditation_expired() public {
        _verify(ana, KYC, true, FUTURE);
        _verify(ana, ACCREDITED, true, uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 31 days);

        _expectNotCompliant(investorHook, IHooks.beforeSwap.selector, ana, "ACCREDITATION_EXPIRED");
        _swap(investorPool, abi.encode(ana));
    }

    // --- liquidity gating ---

    function test_addLiquidity_blocked_when_never_verified() public {
        _expectNotCompliant(dealHook, IHooks.beforeAddLiquidity.selector, rui, "KYC_MISSING");
        _addLiquidity(dealPool, abi.encode(rui));
    }

    function test_addLiquidity_allowed_when_limited() public {
        _verify(ana, KYC, true, FUTURE);
        _addLiquidity(dealPool, abi.encode(ana));
    }

    function test_removeLiquidity_always_free() public {
        // the LP loses compliance entirely — exit must still work on both pools
        vm.prank(admin);
        passport.revokePassport(address(this));

        liquidityRouter.modifyLiquidity(
            dealPool,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -100e18,
                salt: 0
            }),
            abi.encode(address(this))
        );
        liquidityRouter.modifyLiquidity(
            investorPool,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -100e18,
                salt: 0
            }),
            abi.encode(address(this))
        );
    }

    // --- actor resolution ---

    function test_actor_falls_back_to_sender_without_hookData() public {
        // empty hookData → actor is the v4 sender, i.e. the router, which has no claims
        _expectNotCompliant(dealHook, IHooks.beforeSwap.selector, address(swapRouter), "KYC_MISSING");
        _swap(dealPool, "");
    }

    // --- reasonFor is advisory but should match what reverts carry ---

    function test_reasonFor_matches_revert_reason() public {
        assertEq(dealHook.reasonFor(rui), bytes32("KYC_MISSING"));

        _verify(ana, KYC, true, FUTURE);
        assertEq(dealHook.reasonFor(ana), bytes32(0)); // compliant → no reason
        assertEq(investorHook.reasonFor(ana), bytes32("ACCREDITATION_MISSING"));

        vm.prank(admin);
        passport.revokePassport(ana);
        assertEq(dealHook.reasonFor(ana), bytes32("PASSPORT_REVOKED"));
    }
}
