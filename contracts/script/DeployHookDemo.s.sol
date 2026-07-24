// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPoolManager, ModifyLiquidityParams} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../src/ClaimRegistry.sol";
import {CompliancePassport} from "../src/CompliancePassport.sol";
import {AccessGate} from "../src/AccessGate.sol";
import {ComplianceHook} from "../src/hooks/ComplianceHook.sol";

/**
 * @title DeployHookDemo
 * @notice Deploys the full ComplianceHook demo world:
 *         PassportCreds stack → v4 PoolManager + test routers → two gated pools
 *         (Deal Room policy + Investor policy) with liquidity → funded actors.
 *         Writes every address to apps/hook-demo/addresses.json.
 *
 * Local anvil (dev accounts #0 operator, #1 ana, #2 rui — no env needed):
 *   forge script script/DeployHookDemo.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Testnet (e.g. Ethereum Sepolia — set env, see apps/hook-demo/.env.example):
 *   OPERATOR_PK / ANA_PK / RUI_PK  — funded private keys (operator pays deploys)
 *   POOL_MANAGER                   — canonical v4 PoolManager (skips local deploy)
 *   forge script script/DeployHookDemo.s.sol --rpc-url $RPC_URL --broadcast
 */
contract DeployHookDemo is Script {
    uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ANVIL_RUI_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;

    uint256 OPERATOR_PK;
    uint256 ANA_PK;
    uint256 RUI_PK;

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

    address operator;
    address ana;
    address rui;
    uint256 nonce;

    function run() external {
        OPERATOR_PK = vm.envOr("OPERATOR_PK", ANVIL_OPERATOR_PK);
        ANA_PK = vm.envOr("ANA_PK", ANVIL_ANA_PK);
        RUI_PK = vm.envOr("RUI_PK", ANVIL_RUI_PK);
        if (block.chainid != 31337) {
            require(OPERATOR_PK != ANVIL_OPERATOR_PK, "set OPERATOR_PK / ANA_PK / RUI_PK for non-local chains");
        }

        operator = vm.addr(OPERATOR_PK);
        ana = vm.addr(ANA_PK);
        rui = vm.addr(RUI_PK);

        vm.startBroadcast(OPERATOR_PK);
        _deployStack();
        _verifyOperator();
        _deployHooksAndPools();
        vm.stopBroadcast();

        _fundActor(ANA_PK);
        _fundActor(RUI_PK);

        _writeAddresses();

        console.log("ClaimRegistry:      ", address(registry));
        console.log("CompliancePassport: ", address(passport));
        console.log("AccessGate:         ", address(gate));
        console.log("PoolManager:        ", address(poolManager));
        console.log("Deal hook:          ", address(dealHook));
        console.log("Investor hook:      ", address(investorHook));
    }

    function _deployStack() internal {
        registry = new ClaimRegistry(operator);
        passport = new CompliancePassport(operator, address(registry));
        gate = new AccessGate(address(registry), address(passport));

        // The operator plays the CRE role in this demo
        registry.grantRole(registry.CRE_UPDATER_ROLE(), operator);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), operator);

        address existingPoolManager = vm.envOr("POOL_MANAGER", address(0));
        poolManager = existingPoolManager != address(0)
            ? PoolManager(existingPoolManager)
            : new PoolManager(operator);
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new PoolModifyLiquidityTest(poolManager);

        MockERC20 tokenA = new MockERC20("Property Share", "PROP", 18);
        MockERC20 tokenB = new MockERC20("Mock USD", "mUSD", 18);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        token0.mint(operator, 1_000_000 ether);
        token1.mint(operator, 1_000_000 ether);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);
    }

    function _verifyOperator() internal {
        // Operator needs a GREEN passport to seed liquidity in both pools
        uint64 expiry = uint64(block.timestamp + 365 days);
        registry.submitClaim(
            operator, registry.KYC_AML_VERIFIED(), true, _verificationId(), keccak256("demo-attest"), expiry
        );
        passport.syncPassport(operator);
        registry.submitClaim(
            operator, registry.ACCREDITED_INVESTOR(), true, _verificationId(), keccak256("demo-attest"), expiry
        );
        passport.syncPassport(operator);
    }

    function _deployHooksAndPools() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

        dealHook = _deployHook(flags, ComplianceHook.Policy.DEAL_ROOM);
        investorHook = _deployHook(flags, ComplianceHook.Policy.INVESTOR_AREA);

        _createPool(dealHook);
        _createPool(investorHook);
    }

    function _deployHook(uint160 flags, ComplianceHook.Policy policy) internal returns (ComplianceHook hook) {
        bytes memory args = abi.encode(poolManager, gate, registry, passport, policy);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(ComplianceHook).creationCode, args);
        hook = new ComplianceHook{ salt: salt }(poolManager, gate, registry, passport, policy);
        require(address(hook) == hookAddress, "hook address mismatch");
    }

    function _createPool(ComplianceHook hook) internal {
        PoolKey memory key = _poolKey(hook);
        poolManager.initialize(key, 79228162514264337593543950336); // price 1:1
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(60),
                tickUpper: TickMath.maxUsableTick(60),
                liquidityDelta: 10_000e18,
                salt: 0
            }),
            abi.encode(operator)
        );
    }

    function _poolKey(ComplianceHook hook) internal view returns (PoolKey memory) {
        return PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), 3000, 60, IHooks(address(hook))
        );
    }

    function _fundActor(uint256 pk) internal {
        address wallet = vm.addr(pk);
        vm.startBroadcast(OPERATOR_PK);
        token0.mint(wallet, 1_000 ether);
        token1.mint(wallet, 1_000 ether);
        vm.stopBroadcast();

        vm.startBroadcast(pk);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);
        vm.stopBroadcast();
    }

    function _verificationId() internal returns (bytes32) {
        return keccak256(abi.encode("demo-verification", nonce++));
    }

    function _writeAddresses() internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployBlock": ', vm.toString(block.number), ',\n',
            '  "claimRegistry": "', vm.toString(address(registry)), '",\n',
            '  "compliancePassport": "', vm.toString(address(passport)), '",\n',
            '  "accessGate": "', vm.toString(address(gate)), '",\n',
            '  "poolManager": "', vm.toString(address(poolManager)), '",\n',
            '  "swapRouter": "', vm.toString(address(swapRouter)), '",\n',
            '  "liquidityRouter": "', vm.toString(address(liquidityRouter)), '",\n'
        );
        json = string.concat(
            json,
            '  "token0": "', vm.toString(address(token0)), '",\n',
            '  "token0Symbol": "', token0.symbol(), '",\n',
            '  "token1": "', vm.toString(address(token1)), '",\n',
            '  "token1Symbol": "', token1.symbol(), '",\n',
            '  "dealHook": "', vm.toString(address(dealHook)), '",\n',
            '  "investorHook": "', vm.toString(address(investorHook)), '",\n',
            '  "fee": 3000,\n',
            '  "tickSpacing": 60,\n'
        );
        json = string.concat(
            json,
            '  "actors": {\n',
            '    "operator": "', vm.toString(operator), '",\n',
            '    "ana": "', vm.toString(ana), '",\n',
            '    "rui": "', vm.toString(rui), '"\n',
            '  }\n',
            '}\n'
        );
        vm.writeFile("../apps/hook-demo/addresses.json", json);
    }
}
