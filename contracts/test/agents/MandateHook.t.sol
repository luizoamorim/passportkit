// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {IPoolManager, SwapParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {CompliancePassport} from "../../src/CompliancePassport.sol";
import {AccessGate} from "../../src/AccessGate.sol";
import {IAccessGate} from "../../src/interfaces/IAccessGate.sol";
import {HouseTreasury} from "../../src/agents/HouseTreasury.sol";
import {MandateHook} from "../../src/hooks/MandateHook.sol";
import {DemoPositionRouter} from "../../src/demo/DemoPositionRouter.sol";

contract MandateHookTest is Test {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;

    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;
    HouseTreasury treasury;
    MockERC20 musd;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MandateHook hook;
    PoolKey poolKey;
    bool casaIsToken0;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address concierge = makeAddr("concierge");
    address stranger = makeAddr("stranger");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    uint64 FUTURE;
    uint256 nonce;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));
        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();
        _verifyKyc(ownerA);
        _verifyKyc(ownerB);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = new HouseTreasury(owners, 2, IERC20(address(musd)), IAccessGate(address(gate)), "Casa", "CASA");
        vm.prank(ownerA);
        treasury.grantMandate(concierge, 100 ether, FUTURE);
        vm.prank(ownerA);
        treasury.fundConcierge(500 ether);

        poolManager = new PoolManager(address(this));
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);

        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        hook = MandateHook(address(flags ^ (0x4446 << 144)));
        deployCodeTo("MandateHook.sol:MandateHook", abi.encode(poolManager, treasury), address(hook));

        address casaAddr = address(treasury.HOUSE_TOKEN());
        (address t0, address t1) = casaAddr < address(musd) ? (casaAddr, address(musd)) : (address(musd), casaAddr);
        poolKey = PoolKey(Currency.wrap(t0), Currency.wrap(t1), 3000, 60, IHooks(address(hook)));
        poolManager.initialize(poolKey, SQRT_PRICE_1_1);
        casaIsToken0 = t0 == casaAddr;

        // ownerA LPs the pool: needs both tokens (owners can self-mint CASA via a
        // second fundConcierge? no — owners LP mUSD + CASA minted to owner for seeding)
        vm.prank(ownerB);
        treasury.grantMandate(ownerA, 0, FUTURE); // temporarily mandate ownerA to mint seed CASA
        vm.prank(ownerB);
        treasury.fundConcierge(10_000 ether); // mints to ownerA (current mandate agent)
        vm.prank(ownerB);
        treasury.grantMandate(concierge, 100 ether, FUTURE); // restore the real mandate
        musd.mint(ownerA, 10_000 ether);

        vm.startPrank(ownerA);
        treasury.HOUSE_TOKEN().approve(address(liquidityRouter), type(uint256).max);
        musd.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            poolKey, TickMath.minUsableTick(60), TickMath.maxUsableTick(60), 5_000e18, abi.encode(ownerA)
        );
        vm.stopPrank();

        vm.startPrank(concierge);
        treasury.HOUSE_TOKEN().approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();
    }

    function _verifyKyc(address user) internal {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, keccak256(abi.encode(nonce++)), keccak256("attest"), FUTURE);
        passport.syncPassport(user);
        vm.stopPrank();
    }

    /// @dev Sells CASA for mUSD as `who`, announcing `who` through hookData. Kept free of
    ///      any external call before the swap so `vm.expectRevert` binds to the swap itself.
    function _swapAs(address who, int256 amountSpecified) internal {
        vm.prank(who);
        swapRouter.swap(
            poolKey,
            SwapParams({
                zeroForOne: casaIsToken0,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: casaIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            abi.encode(who)
        );
    }

    function _swapAsConcierge(int256 amountSpecified) internal {
        _swapAs(concierge, amountSpecified);
    }

    function _expectNotAuthorized(bytes4 hookFn, address wallet, bytes32 reason) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(hook),
                hookFn,
                abi.encodeWithSelector(MandateHook.NotAuthorized.selector, wallet, reason),
                abi.encodeWithSelector(Hooks.HookCallFailed.selector)
            )
        );
    }

    function test_agent_in_good_standing_can_swap() public {
        uint256 before = musd.balanceOf(concierge);
        _swapAsConcierge(-10e18);
        assertGt(musd.balanceOf(concierge), before);
    }

    function test_agent_swap_over_per_tx_cap_blocked() public {
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "OVER_PER_TX_CAP");
        _swapAsConcierge(-150e18); // cap is 100
    }

    /// @notice A compliant owner takes the hook's fast path: no mandate needed, no cap applied.
    function test_compliant_owner_can_swap() public {
        vm.startPrank(ownerA);
        treasury.HOUSE_TOKEN().approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopPrank();

        uint256 before = musd.balanceOf(ownerA);
        _swapAs(ownerA, -10e18);
        assertGt(musd.balanceOf(ownerA), before);
    }

    function test_expired_mandate_blocks_agent_swap() public {
        vm.warp(uint256(FUTURE) + 1);
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "MANDATE_EXPIRED");
        _swapAsConcierge(-1e18);
    }

    function test_stranger_cannot_swap() public {
        _expectNotAuthorized(IHooks.beforeSwap.selector, stranger, "NO_MANDATE");
        _swapAs(stranger, -1e18);
    }

    function test_owner_revocation_kills_agent_swaps() public {
        vm.prank(admin);
        passport.revokePassport(ownerB);
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "OWNER_NOT_COMPLIANT");
        _swapAsConcierge(-1e18);
    }

    function test_mandate_revocation_kills_agent_swaps() public {
        vm.prank(ownerA);
        treasury.revokeMandate();
        _expectNotAuthorized(IHooks.beforeSwap.selector, concierge, "MANDATE_REVOKED");
        _swapAsConcierge(-1e18);
    }

    function test_non_owner_cannot_add_liquidity() public {
        _expectNotAuthorized(IHooks.beforeAddLiquidity.selector, concierge, "NOT_OWNER");
        vm.prank(concierge);
        liquidityRouter.modifyLiquidity(poolKey, -887220, 887220, 1e18, abi.encode(concierge));
    }

    function test_owner_exit_always_free_even_when_not_compliant() public {
        vm.prank(admin);
        passport.revokePassport(ownerA);
        vm.prank(ownerA);
        liquidityRouter.modifyLiquidity(poolKey, -887220, 887220, -1_000e18, abi.encode(ownerA));
    }
}
