// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {DemoPositionRouter} from "../src/demo/DemoPositionRouter.sol";
import {ComplianceHook, IEligibilityGate, IIdentityResolver} from "../src/hooks/ComplianceHook.sol";
import {MandateHook, IHouseTreasuryStanding} from "../src/hooks/MandateHook.sol";
import {HouseTreasury} from "../src/agents/HouseTreasury.sol";
import {Reason} from "../src/libraries/Types.sol";

/**
 * @title DeployHooks
 * @notice Deploys the v4 hooks against an ALREADY-DEPLOYED PassportKit stack and an
 *         ALREADY-DEPLOYED canonical PoolManager. `DeployAll.s.sol` builds a whole world
 *         from nothing (local anvil); this script assumes the world exists and only adds
 *         the Uniswap surface, so it is re-runnable and safe against a live testnet.
 *
 *         A v4 hook address must ENCODE its permissions in its low 14 bits, so both hooks
 *         are mined with HookMiner and deployed through the CREATE2 factory
 *         (0x4e59b448...). `forge script --broadcast` routes `new X{salt: s}` through that
 *         factory automatically, which is why HookMiner.find is given CREATE2_FACTORY as
 *         the deployer. Deploying with a plain CREATE would revert in BaseHook.
 *
 * Required env:
 *   DEPLOYER_PRIVATE_KEY        funded key; pays every deploy and becomes the LP
 *   ELIGIBILITY_GATE_ADDRESS    from deployments/<chainid>.json
 *   IDENTITY_FACTORY_ADDRESS    from deployments/<chainid>.json (the hook's wallet->identity resolver)
 *
 * Optional env:
 *   POOL_MANAGER      canonical v4 PoolManager; defaults per chain id (Eth/Base Sepolia)
 *   TOKEN_A, TOKEN_B  the pool pair. Unset -> deploys PROP + mUSD mocks and mints to the deployer
 *   SEED_LIQUIDITY    "true" -> deploys the demo routers and adds full-range liquidity to both
 *                     pools. Requires the deployer to already pass BOTH policies, because
 *                     beforeAddLiquidity is gated by the very hook being deployed
 *   HOUSE_TREASURY    a deployed HouseTreasury -> also mines MandateHook and opens the
 *                     CASA/SPEND_TOKEN pool. Unset -> ComplianceHook pools only
 *
 * Run:
 *   forge script script/DeployHooks.s.sol --rpc-url $RPC_URL --broadcast -vvv
 *   (add --verify --etherscan-api-key $ETHERSCAN_API_KEY to verify the hooks)
 *
 * Writes deployments/<chainid>-hooks.json. Requires fs_permissions on ./deployments.
 */
contract DeployHooks is Script {
    /// 1:1 starting price, and the fee/spacing the repo uses everywhere.
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE = 3000;

    /// Repo-wide policy ids: 1 = Deal Room (KYC), 2 = Investor (KYC + accredited).
    uint256 constant POLICY_DEAL_ROOM = 1;
    uint256 constant POLICY_INVESTOR = 2;

    /// Canonical v4 PoolManagers (docs.uniswap.org/contracts/v4/deployments).
    address constant ETH_SEPOLIA_POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;

    /// Both hooks gate entry only: swap + add-liquidity. Exit is never gated.
    uint160 constant HOOK_FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

    // Inputs (storage, so run() stays under the local-variable limit).
    address internal deployer;
    IPoolManager internal poolManager;
    address internal gate;
    address internal identityFactory;
    address internal treasury;

    // Outputs.
    address internal token0;
    address internal token1;
    address internal dealHook;
    address internal investorHook;
    address internal mandateHook;
    address internal swapRouter;
    address internal liquidityRouter;
    bool internal seeded;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        // Not envOr(_defaultPoolManager()): Solidity evaluates the default eagerly, so an
        // unknown chain id would revert even when POOL_MANAGER is set.
        address configuredPoolManager = vm.envOr("POOL_MANAGER", address(0));
        poolManager = IPoolManager(
            configuredPoolManager == address(0) ? _defaultPoolManager() : configuredPoolManager
        );
        gate = vm.envAddress("ELIGIBILITY_GATE_ADDRESS");
        identityFactory = vm.envAddress("IDENTITY_FACTORY_ADDRESS");
        treasury = vm.envOr("HOUSE_TREASURY", address(0));
        bool seedLiquidity = vm.envOr("SEED_LIQUIDITY", false);

        _preflight(seedLiquidity);

        vm.startBroadcast(deployerKey);

        _resolveTokens();
        dealHook = _deployComplianceHook(POLICY_DEAL_ROOM);
        investorHook = _deployComplianceHook(POLICY_INVESTOR);
        poolManager.initialize(_poolKey(token0, token1, dealHook), SQRT_PRICE_1_1);
        poolManager.initialize(_poolKey(token0, token1, investorHook), SQRT_PRICE_1_1);

        if (treasury != address(0)) _deployMandateHook();
        if (seedLiquidity) _seedLiquidity();

        vm.stopBroadcast();

        _report();
        _writeDeployments();
    }

    // --- preflight -----------------------------------------------------------------

    /**
     * Everything that would waste a real transaction is checked BEFORE broadcasting:
     * a PoolManager with no code, a gate/factory that never got deployed, and — the one
     * that actually bites — seeding liquidity with a deployer the hook will refuse.
     * beforeAddLiquidity consults the same gate, so an unverified deployer cannot LP into
     * its own pool.
     */
    function _preflight(bool seedLiquidity) internal view {
        require(address(poolManager).code.length > 0, "POOL_MANAGER has no code on this chain");
        require(gate.code.length > 0, "ELIGIBILITY_GATE_ADDRESS has no code on this chain");
        require(identityFactory.code.length > 0, "IDENTITY_FACTORY_ADDRESS has no code on this chain");
        if (treasury != address(0)) {
            require(treasury.code.length > 0, "HOUSE_TREASURY has no code on this chain");
        }
        if (!seedLiquidity) return;

        (bool okDeal, bytes32 dealReason) = _eligibility(deployer, POLICY_DEAL_ROOM);
        (bool okInvestor, bytes32 investorReason) = _eligibility(deployer, POLICY_INVESTOR);
        if (!okDeal || !okInvestor) {
            console2.log("deployer                ", deployer);
            console2.log("deal-room policy reason ", _reasonText(dealReason));
            console2.log("investor policy reason  ", _reasonText(investorReason));
            revert(
                "SEED_LIQUIDITY needs a deployer passing BOTH policies (identity + KYC + accredited) - issue the claims first, or unset SEED_LIQUIDITY"
            );
        }
    }

    /// The exact read the hook performs, so a refusal here is the refusal you would get.
    function _eligibility(address wallet, uint256 policyId) internal view returns (bool, bytes32) {
        address identity = IIdentityResolver(identityFactory).identityOfWallet(wallet);
        if (identity == address(0)) return (false, Reason.NO_IDENTITY);
        return IEligibilityGate(gate).isEligible(identity, policyId);
    }

    /// Reason codes are ASCII right-padded into a bytes32; trim so the log reads
    /// "MISSING_KYC" rather than a hex blob.
    function _reasonText(bytes32 reason) internal pure returns (string memory) {
        uint256 len;
        while (len < 32 && reason[len] != 0) len++;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; i++) out[i] = reason[i];
        return string(out);
    }

    function _defaultPoolManager() internal view returns (address) {
        if (block.chainid == 11155111) return ETH_SEPOLIA_POOL_MANAGER;
        if (block.chainid == 84532) return BASE_SEPOLIA_POOL_MANAGER;
        revert("no canonical PoolManager known for this chain - set POOL_MANAGER");
    }

    // --- deploys -------------------------------------------------------------------

    /// The pair: bring your own two ERC-20s, or get PROP/mUSD mocks minted to the deployer.
    function _resolveTokens() internal {
        address a = vm.envOr("TOKEN_A", address(0));
        address b = vm.envOr("TOKEN_B", address(0));

        if (a == address(0) || b == address(0)) {
            MockERC20 prop = new MockERC20("Property Share", "PROP", 18);
            MockERC20 musd = new MockERC20("Mock USD", "mUSD", 18);
            prop.mint(deployer, 1_000_000 ether);
            musd.mint(deployer, 1_000_000 ether);
            (a, b) = (address(prop), address(musd));
        }

        require(a != b, "TOKEN_A and TOKEN_B must differ");
        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    /**
     * Mine a salt whose CREATE2 address carries HOOK_FLAGS in its low 14 bits, then deploy
     * to it. The require is not paranoia: if forge ever stopped routing salted creates
     * through CREATE2_FACTORY, the address would silently differ from the mined one and
     * the pool would be initialized against a hook the PoolManager rejects.
     */
    function _deployComplianceHook(uint256 policyId) internal returns (address) {
        bytes memory args = abi.encode(poolManager, gate, identityFactory, policyId);
        (address mined, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, HOOK_FLAGS, type(ComplianceHook).creationCode, args);

        ComplianceHook hook = new ComplianceHook{ salt: salt }(
            poolManager, IEligibilityGate(gate), IIdentityResolver(identityFactory), policyId
        );
        require(address(hook) == mined, "compliance hook address mismatch");
        return address(hook);
    }

    /// The house pool trades the treasury's scrip against its spend token, gated on the
    /// agent's mandate rather than on a policy — same miner, different authority question.
    function _deployMandateHook() internal {
        bytes memory args = abi.encode(poolManager, treasury);
        (address mined, bytes32 salt) = HookMiner.find(CREATE2_FACTORY, HOOK_FLAGS, type(MandateHook).creationCode, args);

        MandateHook hook = new MandateHook{ salt: salt }(poolManager, IHouseTreasuryStanding(treasury));
        require(address(hook) == mined, "mandate hook address mismatch");
        mandateHook = address(hook);

        address casa = address(HouseTreasury(treasury).HOUSE_TOKEN());
        address spend = address(HouseTreasury(treasury).SPEND_TOKEN());
        poolManager.initialize(_poolKey(casa, spend, mandateHook), SQRT_PRICE_1_1);
    }

    /// Currencies must be sorted; the hook completes the key.
    function _poolKey(address a, address b, address hook) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), FEE, TICK_SPACING, IHooks(hook));
    }

    /**
     * Full-range liquidity in both ComplianceHook pools, through the same routers the demo
     * runtime drives. The house pool is left empty: its CASA can only be minted by the
     * treasury to the current mandate holder, so seeding it is a treasury operation, not a
     * deploy one (DeployAll._seedHouseLiquidity does it locally with a temporary mandate).
     */
    function _seedLiquidity() internal {
        swapRouter = address(new PoolSwapTest(poolManager));
        liquidityRouter = address(new DemoPositionRouter(poolManager));

        MockERC20(token0).approve(swapRouter, type(uint256).max);
        MockERC20(token1).approve(swapRouter, type(uint256).max);
        MockERC20(token0).approve(liquidityRouter, type(uint256).max);
        MockERC20(token1).approve(liquidityRouter, type(uint256).max);

        _addLiquidity(dealHook);
        _addLiquidity(investorHook);
        seeded = true;
    }

    function _addLiquidity(address hook) internal {
        DemoPositionRouter(liquidityRouter).modifyLiquidity(
            _poolKey(token0, token1, hook),
            TickMath.minUsableTick(TICK_SPACING),
            TickMath.maxUsableTick(TICK_SPACING),
            10_000e18,
            abi.encode(deployer) // the actor the hook checks; `sender` here is the router
        );
    }

    // --- output --------------------------------------------------------------------

    function _report() internal view {
        console2.log("chainId                 ", block.chainid);
        console2.log("PoolManager             ", address(poolManager));
        console2.log("EligibilityGate         ", gate);
        console2.log("IdentityFactory         ", identityFactory);
        console2.log("--- hooks ---");
        console2.log("ComplianceHook (deal)   ", dealHook);
        console2.log("ComplianceHook (invest) ", investorHook);
        console2.log("MandateHook             ", mandateHook);
        console2.log("--- pool ---");
        console2.log("token0                  ", token0);
        console2.log("token1                  ", token1);
        console2.log("fee / tickSpacing        3000 / 60");
        console2.log("swapRouter              ", swapRouter);
        console2.log("liquidityRouter         ", liquidityRouter);
        console2.log("liquidity seeded        ", seeded);
    }

    function _writeDeployments() internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployBlock": ', vm.toString(block.number), ',\n',
            '  "poolManager": "', vm.toString(address(poolManager)), '",\n',
            '  "eligibilityGate": "', vm.toString(gate), '",\n',
            '  "identityFactory": "', vm.toString(identityFactory), '",\n',
            '  "dealHook": "', vm.toString(dealHook), '",\n',
            '  "investorHook": "', vm.toString(investorHook), '",\n',
            '  "mandateHook": "', vm.toString(mandateHook), '",\n',
            '  "treasury": "', vm.toString(treasury), '",\n'
        );
        json = string.concat(
            json,
            '  "token0": "', vm.toString(token0), '",\n',
            '  "token1": "', vm.toString(token1), '",\n',
            '  "swapRouter": "', vm.toString(swapRouter), '",\n',
            '  "liquidityRouter": "', vm.toString(liquidityRouter), '",\n',
            '  "fee": ', vm.toString(uint256(FEE)), ',\n',
            '  "tickSpacing": ', vm.toString(uint256(uint24(TICK_SPACING))), ',\n',
            '  "policies": { "deal": 1, "investor": 2 }\n',
            '}\n'
        );

        string memory path = string.concat("deployments/", vm.toString(block.chainid), "-hooks.json");
        vm.writeFile(path, json);
        console2.log("wrote", path);
    }
}
