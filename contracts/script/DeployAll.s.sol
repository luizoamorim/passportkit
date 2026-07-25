// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {DemoPositionRouter} from "../src/demo/DemoPositionRouter.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {Identity} from "../src/Identity.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";
import {ComplianceHook, IEligibilityGate, IIdentityResolver} from "../src/hooks/ComplianceHook.sol";
// Same shapes as the hook's, but distinct Solidity types — alias to keep both in one file.
import {
    HouseTreasury,
    IEligibilityGate as IHouseGate,
    IIdentityResolver as IHouseResolver
} from "../src/agents/HouseTreasury.sol";
import {HouseToken} from "../src/agents/HouseToken.sol";
import {MandateHook, IHouseTreasuryStanding} from "../src/hooks/MandateHook.sol";

/**
 * @title DeployAll
 * @notice One script, one chain world — the union of the ComplianceHook demo and the
 *         House Concierge demo on a single PassportKit stack and a single v4 PoolManager:
 *
 *         IssuerRegistry → ClaimIssuer → IdentityFactory → EligibilityGate (policies 1 + 2)
 *           → PoolManager + routers (deployed ONCE)
 *           → PROP/mUSD pools gated by ComplianceHook (policy 1 Deal Room, policy 2 Investor)
 *           → HouseTreasury (owners operator + ana, 2-of-2, policy 1) + CASA/mUSD pool
 *             gated by MandateHook, with the concierge's mandate funded.
 *
 *         Every address lands in ONE file: apps/web/demo-addresses.json.
 *
 * The operator plays every platform role: admin, issuer signer (EIP-712) and LP.
 * Claims follow Model B — the operator SIGNS off-chain, the holder SUBMITS from their wallet.
 * The concierge and the plumber deliberately get NO identity: the agent's authority is
 * the owners', never its own.
 *
 * Starting state:
 *   operator — identity + KYC + accredited (clears both pool policies, LPs everywhere)
 *   ana      — identity + KYC (house co-owner, clears the Deal Room pool only)
 *   rui      — identity, no claims (refused everywhere until verified live in the demo)
 *   concierge / plumber — plain wallets, no identity
 *   house    — 50_000 mUSD deposited, mandate to concierge (cap 200e18, +365d), 500 CASA funded
 *
 * Local anvil (dev accounts #0 operator, #1 ana, #2 rui, #3 concierge, #4 plumber):
 *   forge script script/DeployAll.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Testnet (set env — the operator pays every deploy):
 *   OPERATOR_PK / ANA_PK / RUI_PK / CONCIERGE_PK / PLUMBER_PK — funded private keys
 *   POOL_MANAGER                                             — canonical v4 PoolManager
 */
contract DeployAll is Script {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE = 3000;

    uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ANVIL_RUI_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant ANVIL_CONCIERGE_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant ANVIL_PLUMBER_PK = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    /// Policy ids are repo-wide constants (see apps/api/.env.example). The house gates its
    /// owners on the Deal Room policy — the same policy id as the deal pool. One decision core.
    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]
    uint256 constant POLICY_INVESTOR = 2; // [KYC_VERIFIED, ACCREDITED_INVESTOR]

    uint256 OPERATOR_PK;
    uint256 ANA_PK;
    uint256 RUI_PK;
    uint256 CONCIERGE_PK;
    uint256 PLUMBER_PK;

    IssuerRegistry issuerRegistry;
    ClaimIssuer claimIssuer;
    IdentityFactory identityFactory;
    EligibilityGate eligibilityGate;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    MockERC20 token0;
    MockERC20 token1;
    MockERC20 musd; // the shared settlement token — also token0 or token1 of the PROP pools
    ComplianceHook dealHook;
    ComplianceHook investorHook;

    HouseTreasury treasury;
    HouseToken casa;
    MandateHook mandateHook;
    PoolKey housePoolKey;

    address operator;
    address ana;
    address rui;
    address concierge;
    address plumber;
    address operatorIdentity;
    address anaIdentity;
    address ruiIdentity;
    uint256 nonce;

    function run() external {
        _loadKeys();

        vm.startBroadcast(OPERATOR_PK);
        _deployStack();
        _onboardActors();
        _deployPoolInfra();
        _deployComplianceHooks();
        _deployHouse();
        _seedHouseLiquidity();
        vm.stopBroadcast();

        // Model B: ana submits her own signed claim from her own wallet
        _submitClaim(ANA_PK, anaIdentity, ClaimTopics.KYC_VERIFIED);

        _fundActor(ANA_PK);
        _fundActor(RUI_PK);
        _approveHouseActors();

        _writeAddresses();
        _log();
    }

    function _loadKeys() internal {
        OPERATOR_PK = vm.envOr("OPERATOR_PK", ANVIL_OPERATOR_PK);
        ANA_PK = vm.envOr("ANA_PK", ANVIL_ANA_PK);
        RUI_PK = vm.envOr("RUI_PK", ANVIL_RUI_PK);
        CONCIERGE_PK = vm.envOr("CONCIERGE_PK", ANVIL_CONCIERGE_PK);
        PLUMBER_PK = vm.envOr("PLUMBER_PK", ANVIL_PLUMBER_PK);
        if (block.chainid != 31337) {
            require(OPERATOR_PK != ANVIL_OPERATOR_PK, "set OPERATOR_PK / ANA_PK / RUI_PK / CONCIERGE_PK / PLUMBER_PK");
        }

        operator = vm.addr(OPERATOR_PK);
        ana = vm.addr(ANA_PK);
        rui = vm.addr(RUI_PK);
        concierge = vm.addr(CONCIERGE_PK);
        plumber = vm.addr(PLUMBER_PK);
    }

    // --- PassportKit stack (deployed once, shared by every surface) ---

    function _deployStack() internal {
        issuerRegistry = new IssuerRegistry(operator);
        claimIssuer = new ClaimIssuer(operator, operator); // the operator key is the EIP-712 signer
        identityFactory = new IdentityFactory(operator, address(issuerRegistry));
        eligibilityGate = new EligibilityGate(operator, address(issuerRegistry));

        issuerRegistry.setTrusted(address(claimIssuer), ClaimTopics.KYC_VERIFIED, true);
        issuerRegistry.setTrusted(address(claimIssuer), ClaimTopics.ACCREDITED_INVESTOR, true);

        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = ClaimTopics.KYC_VERIFIED;
        eligibilityGate.setPolicy(POLICY_DEAL_ROOM, dealTopics);

        uint256[] memory investorTopics = new uint256[](2);
        investorTopics[0] = ClaimTopics.KYC_VERIFIED;
        investorTopics[1] = ClaimTopics.ACCREDITED_INVESTOR;
        eligibilityGate.setPolicy(POLICY_INVESTOR, investorTopics);
    }

    /// One identity per person. The operator clears both policies so it can seed liquidity;
    /// ana's KYC lands from her own wallet after this broadcast block; rui starts bare.
    /// The concierge and the plumber get no identity at all.
    function _onboardActors() internal {
        operatorIdentity = identityFactory.createIdentity(operator);
        anaIdentity = identityFactory.createIdentity(ana);
        ruiIdentity = identityFactory.createIdentity(rui);

        _signAndSubmit(operatorIdentity, ClaimTopics.KYC_VERIFIED);
        _signAndSubmit(operatorIdentity, ClaimTopics.ACCREDITED_INVESTOR);
    }

    /// Signs (issuer) and submits (holder) in one call — only valid while broadcasting as the holder.
    function _signAndSubmit(address identity, uint256 topic) internal {
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
    }

    function _submitClaim(uint256 holderPk, address identity, uint256 topic) internal {
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        vm.startBroadcast(holderPk);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
        vm.stopBroadcast();
    }

    /// EIP-712 "Claim" signed by the issuer signer (the operator key). Zero PII: only a hash.
    function _signClaim(address identity, uint256 topic)
        internal
        returns (bytes memory sig, bytes memory data)
    {
        uint64 expiresAt = uint64(block.timestamp + 365 days);
        bytes32 dataHash = keccak256(abi.encode("demo-attest", nonce));
        bytes32 claimNonce = keccak256(abi.encode("demo-session", nonce++));
        data = abi.encode(dataHash, expiresAt, claimNonce);

        bytes32 typeHash = keccak256(
            "Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)"
        );
        bytes32 structHash = keccak256(abi.encode(typeHash, identity, topic, dataHash, expiresAt, claimNonce));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PassportKitClaim"),
                keccak256("1"),
                block.chainid,
                address(claimIssuer)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(OPERATOR_PK, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        sig = abi.encodePacked(r, s, v);
    }

    // --- Uniswap v4: one PoolManager, one pair of routers, one mUSD ---

    function _deployPoolInfra() internal {
        address existingPoolManager = vm.envOr("POOL_MANAGER", address(0));
        poolManager = existingPoolManager != address(0)
            ? PoolManager(existingPoolManager)
            : new PoolManager(operator);
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);

        MockERC20 prop = new MockERC20("Property Share", "PROP", 18);
        musd = new MockERC20("Mock USD", "mUSD", 18);
        (token0, token1) = address(prop) < address(musd) ? (prop, musd) : (musd, prop);

        token0.mint(operator, 1_000_000 ether);
        token1.mint(operator, 1_000_000 ether);
        token0.approve(address(swapRouter), type(uint256).max);
        token1.approve(address(swapRouter), type(uint256).max);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);

        musd.mint(ana, 1_000 ether);
    }

    function _deployComplianceHooks() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

        dealHook = _deployComplianceHook(flags, POLICY_DEAL_ROOM);
        investorHook = _deployComplianceHook(flags, POLICY_INVESTOR);

        _createCompliancePool(dealHook);
        _createCompliancePool(investorHook);
    }

    function _deployComplianceHook(uint160 flags, uint256 policyId) internal returns (ComplianceHook hook) {
        bytes memory args = abi.encode(poolManager, eligibilityGate, identityFactory, policyId);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(ComplianceHook).creationCode, args);
        hook = new ComplianceHook{ salt: salt }(
            poolManager,
            IEligibilityGate(address(eligibilityGate)),
            IIdentityResolver(address(identityFactory)),
            policyId
        );
        require(address(hook) == hookAddress, "compliance hook address mismatch");
    }

    function _createCompliancePool(ComplianceHook hook) internal {
        PoolKey memory key = PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), FEE, TICK_SPACING, IHooks(address(hook))
        );
        poolManager.initialize(key, SQRT_PRICE_1_1);
        liquidityRouter.modifyLiquidity(
            key,
            TickMath.minUsableTick(TICK_SPACING),
            TickMath.maxUsableTick(TICK_SPACING),
            10_000e18,
            abi.encode(operator)
        );
    }

    // --- The house: treasury, mandate, CASA/mUSD pool ---

    function _deployHouse() internal {
        address[] memory owners = new address[](2);
        owners[0] = operator;
        owners[1] = ana;
        treasury = new HouseTreasury(
            owners,
            2,
            IERC20(address(musd)),
            /* the house reuses the very same gate + resolver as the pools */
            IHouseGate(address(eligibilityGate)),
            IHouseResolver(address(identityFactory)),
            POLICY_DEAL_ROOM,
            "Casa Azul Scrip",
            "CASA"
        );
        casa = treasury.HOUSE_TOKEN();

        musd.approve(address(treasury), 50_000 ether);
        treasury.deposit(50_000 ether);

        treasury.grantMandate(concierge, 200 ether, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(500 ether);

        _deployMandateHook();
    }

    function _deployMandateHook() internal {
        uint160 flags = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);
        bytes memory args = abi.encode(poolManager, treasury);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, flags, type(MandateHook).creationCode, args);
        mandateHook = new MandateHook{ salt: salt }(poolManager, IHouseTreasuryStanding(address(treasury)));
        require(address(mandateHook) == hookAddress, "mandate hook address mismatch");

        (Currency currency0, Currency currency1) = address(casa) < address(musd)
            ? (Currency.wrap(address(casa)), Currency.wrap(address(musd)))
            : (Currency.wrap(address(musd)), Currency.wrap(address(casa)));
        housePoolKey = PoolKey(currency0, currency1, FEE, TICK_SPACING, IHooks(address(mandateHook)));
        poolManager.initialize(housePoolKey, SQRT_PRICE_1_1);
    }

    function _seedHouseLiquidity() internal {
        // Temporary-mandate trick: mint seed CASA to the operator so it can LP, then
        // restore the concierge's real mandate.
        treasury.grantMandate(operator, 0, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(20_000 ether); // mints to operator (current mandate agent)
        treasury.grantMandate(concierge, 200 ether, uint64(block.timestamp + 365 days));

        casa.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            housePoolKey,
            TickMath.minUsableTick(TICK_SPACING),
            TickMath.maxUsableTick(TICK_SPACING),
            10_000e18,
            abi.encode(operator)
        );
    }

    // --- Actor funding + approvals ---

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

    /// Ana can top the house up; the concierge can liquify its CASA budget.
    function _approveHouseActors() internal {
        vm.startBroadcast(ANA_PK);
        musd.approve(address(treasury), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(CONCIERGE_PK);
        casa.approve(address(swapRouter), type(uint256).max);
        musd.approve(address(swapRouter), type(uint256).max);
        vm.stopBroadcast();
    }

    // --- Output: ONE file for the whole site ---

    function _writeAddresses() internal {
        string memory json = string.concat(
            '{\n',
            '  "chainId": ', vm.toString(block.chainid), ',\n',
            '  "deployBlock": ', vm.toString(block.number), ',\n',
            '  "issuerRegistry": "', vm.toString(address(issuerRegistry)), '",\n',
            '  "claimIssuer": "', vm.toString(address(claimIssuer)), '",\n',
            '  "identityFactory": "', vm.toString(address(identityFactory)), '",\n',
            '  "eligibilityGate": "', vm.toString(address(eligibilityGate)), '",\n',
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
            '  "investorHook": "', vm.toString(address(investorHook)), '",\n'
        );
        json = string.concat(
            json,
            '  "treasury": "', vm.toString(address(treasury)), '",\n',
            '  "mandateHook": "', vm.toString(address(mandateHook)), '",\n',
            '  "casa": "', vm.toString(address(casa)), '",\n',
            '  "musd": "', vm.toString(address(musd)), '",\n',
            '  "fee": ', vm.toString(uint256(FEE)), ',\n',
            '  "tickSpacing": ', vm.toString(uint256(int256(TICK_SPACING))), ',\n'
        );
        json = string.concat(
            json,
            '  "policies": {\n',
            '    "deal": ', vm.toString(POLICY_DEAL_ROOM), ',\n',
            '    "investor": ', vm.toString(POLICY_INVESTOR), '\n',
            '  },\n',
            '  "actors": {\n',
            '    "operator": "', vm.toString(operator), '",\n',
            '    "ana": "', vm.toString(ana), '",\n',
            '    "rui": "', vm.toString(rui), '",\n',
            '    "concierge": "', vm.toString(concierge), '",\n',
            '    "plumber": "', vm.toString(plumber), '"\n',
            '  },\n'
        );
        json = string.concat(
            json,
            '  "identities": {\n',
            '    "operator": "', vm.toString(operatorIdentity), '",\n',
            '    "ana": "', vm.toString(anaIdentity), '",\n',
            '    "rui": "', vm.toString(ruiIdentity), '"\n',
            '  }\n',
            '}\n'
        );
        vm.writeFile("../apps/web/demo-addresses.json", json);
    }

    function _log() internal view {
        console.log("IssuerRegistry:     ", address(issuerRegistry));
        console.log("ClaimIssuer:        ", address(claimIssuer));
        console.log("IdentityFactory:    ", address(identityFactory));
        console.log("EligibilityGate:    ", address(eligibilityGate));
        console.log("PoolManager:        ", address(poolManager));
        console.log("Deal hook:          ", address(dealHook));
        console.log("Investor hook:      ", address(investorHook));
        console.log("HouseTreasury:      ", address(treasury));
        console.log("MandateHook:        ", address(mandateHook));
        console.log("addresses ->         apps/web/demo-addresses.json");
    }
}
