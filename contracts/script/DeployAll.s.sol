// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolSwapTest} from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import {DemoPositionRouter} from "../src/demo/DemoPositionRouter.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

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
 * REUSE MODE. Every piece that can already exist on a public chain is taken from env when
 * set, and deployed exactly as before when unset — so the local `make demo` path is
 * untouched while a Sepolia run adds only what is missing (the house). The whole script is
 * idempotent on the pieces it reuses: identities that exist are not re-created, claims that
 * still verify are not re-signed, policies that already match are not re-wired and pools
 * that are already initialized are not re-initialized. `script/DeployHooks.s.sol` uses the
 * same env names for the same things (POOL_MANAGER / TOKEN_A / TOKEN_B / DEAL_HOOK /
 * INVESTOR_HOOK); keep the two consistent.
 *
 * Local anvil (dev accounts #0 operator, #1 ana, #2 rui, #3 concierge, #4 plumber):
 *   forge script script/DeployAll.s.sol --rpc-url http://localhost:8545 --broadcast
 *
 * Testnet (set env — the operator pays every deploy AND every actor's gas):
 *   OPERATOR_PK / ANA_PK / RUI_PK / CONCIERGE_PK / PLUMBER_PK — private keys; required
 *     off anvil. OPERATOR_PK must be an authorized signer on the ClaimIssuer below.
 *
 * Optional reuse env (unset -> deploy fresh, i.e. today's local behaviour):
 *   ISSUER_REGISTRY   an IssuerRegistry to trust our ClaimIssuer on
 *   CLAIM_ISSUER      the EIP-712 issuer; must already authorize OPERATOR_PK's address
 *   IDENTITY_FACTORY  wallet -> Identity resolver; the operator needs AGENT_ROLE on it
 *   ELIGIBILITY_GATE  the decision core; the operator needs DEFAULT_ADMIN_ROLE on it ONLY
 *                     if policies 1/2 are not already wired exactly as this script wants
 *   POOL_MANAGER      canonical v4 PoolManager
 *   TOKEN_A, TOKEN_B  the pool pair, in any order (sorted here). Both or neither.
 *                     Unset -> deploys the PROP + mUSD mocks and mints 1M of each
 *   SPEND_TOKEN       REQUIRED with TOKEN_A/TOKEN_B: which of the two the house settles in
 *                     (the treasury's SPEND_TOKEN, the CASA pool's other side, and the
 *                     `musd` key of demo-addresses.json — the web reads it as "the same
 *                     contract as token0 or token1", so it must be one of the pair)
 *   DEAL_HOOK, INVESTOR_HOOK
 *                     already-mined (and verified) ComplianceHooks to reuse instead of
 *                     re-mining. Require ELIGIBILITY_GATE + IDENTITY_FACTORY + POOL_MANAGER,
 *                     because a hook's gate/resolver/manager are immutable and are checked
 *   ACTOR_ETH_WEI     gas floor topped up per actor wallet off anvil (default 0.02 ether;
 *                     0 disables). Anvil pre-funds its dev accounts, so this is skipped there
 *
 * The house (HouseTreasury + CASA + MandateHook + the CASA/spend pool) has no reuse env:
 * it is always deployed fresh, and the MandateHook salt is mined against THAT treasury, so
 * a re-run simply produces a new house rather than colliding with the old one.
 */
contract DeployAll is Script {
    uint160 constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    int24 constant TICK_SPACING = 60;
    uint24 constant FEE = 3000;

    /// Both hooks gate entry only: swap + add-liquidity. Exit is never gated.
    uint160 constant HOOK_FLAGS = uint160(Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG);

    uint256 constant ANVIL_OPERATOR_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant ANVIL_ANA_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    uint256 constant ANVIL_RUI_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a;
    uint256 constant ANVIL_CONCIERGE_PK = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6;
    uint256 constant ANVIL_PLUMBER_PK = 0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a;

    /// Policy ids are repo-wide constants (see apps/api/.env.example). The house gates its
    /// owners on the Deal Room policy — the same policy id as the deal pool. One decision core.
    uint256 constant POLICY_DEAL_ROOM = 1; // [KYC_VERIFIED]
    uint256 constant POLICY_INVESTOR = 2; // [KYC_VERIFIED, ACCREDITED_INVESTOR]

    uint256 constant OPERATOR_TOKENS = 1_000_000 ether; // minted only when we deploy the mocks
    uint256 constant ACTOR_TOKENS = 1_000 ether; // per actor, per token
    uint256 constant HOUSE_DEPOSIT = 50_000 ether; // spend token parked in the treasury
    uint256 constant HOUSE_SEED_CASA = 20_000 ether; // minted to the operator to LP the house pool
    uint256 constant DEFAULT_ACTOR_ETH = 0.02 ether; // gas floor per actor off anvil

    uint256 OPERATOR_PK;
    uint256 ANA_PK;
    uint256 RUI_PK;
    uint256 CONCIERGE_PK;
    uint256 PLUMBER_PK;

    // Reuse inputs, resolved once in _loadConfig(). address(0) means "deploy it".
    address envIssuerRegistry;
    address envClaimIssuer;
    address envIdentityFactory;
    address envEligibilityGate;
    address envPoolManager;
    address envTokenA;
    address envTokenB;
    address envSpendToken;
    address envDealHook;
    address envInvestorHook;
    uint256 actorEthFloor;

    IssuerRegistry issuerRegistry;
    ClaimIssuer claimIssuer;
    IdentityFactory identityFactory;
    EligibilityGate eligibilityGate;

    PoolManager poolManager;
    PoolSwapTest swapRouter;
    DemoPositionRouter liquidityRouter;
    address token0;
    address token1;
    address musd; // the shared settlement token — also token0 or token1 of the PROP pools
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
        _loadConfig();
        _preflight();
        // Before anything the actors have to sign themselves (ana's claim, every approval).
        _fundGas();

        vm.startBroadcast(OPERATOR_PK);
        _deployStack();
        _onboardActors();
        _deployPoolInfra();
        _deployComplianceHooks();
        _deployHouse();
        _seedHouseLiquidity();
        vm.stopBroadcast();

        // Model B: ana submits her own signed claim from her own wallet
        _ensureHolderClaim(ANA_PK, anaIdentity, ClaimTopics.KYC_VERIFIED);

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

    /// Everything reusable, read in one place so _preflight() can judge the whole set
    /// before a single transaction is signed.
    function _loadConfig() internal {
        envIssuerRegistry = vm.envOr("ISSUER_REGISTRY", address(0));
        envClaimIssuer = vm.envOr("CLAIM_ISSUER", address(0));
        envIdentityFactory = vm.envOr("IDENTITY_FACTORY", address(0));
        envEligibilityGate = vm.envOr("ELIGIBILITY_GATE", address(0));
        envPoolManager = vm.envOr("POOL_MANAGER", address(0));
        envTokenA = vm.envOr("TOKEN_A", address(0));
        envTokenB = vm.envOr("TOKEN_B", address(0));
        envSpendToken = vm.envOr("SPEND_TOKEN", address(0));
        envDealHook = vm.envOr("DEAL_HOOK", address(0));
        envInvestorHook = vm.envOr("INVESTOR_HOOK", address(0));
        actorEthFloor = vm.envOr("ACTOR_ETH_WEI", DEFAULT_ACTOR_ETH);
    }

    // --- preflight -----------------------------------------------------------------

    /**
     * Reuse fails in two ways, and both are cheaper to catch here than on chain: an address
     * that holds no code (wrong chain, typo), and an address that holds the RIGHT contract
     * wired to the WRONG world. The second is the dangerous one — a gate reading a foreign
     * IssuerRegistry, or a hook whose immutable gate is not the gate we are about to issue
     * claims through, produces a world that deploys cleanly and then refuses everyone.
     */
    function _preflight() internal view {
        _requireCode(envIssuerRegistry, "ISSUER_REGISTRY");
        _requireCode(envClaimIssuer, "CLAIM_ISSUER");
        _requireCode(envIdentityFactory, "IDENTITY_FACTORY");
        _requireCode(envEligibilityGate, "ELIGIBILITY_GATE");
        _requireCode(envPoolManager, "POOL_MANAGER");
        _requireCode(envTokenA, "TOKEN_A");
        _requireCode(envTokenB, "TOKEN_B");
        _requireCode(envDealHook, "DEAL_HOOK");
        _requireCode(envInvestorHook, "INVESTOR_HOOK");

        // The gate's and the factory's registry are immutable: reusing either one pins the
        // registry too, so a fresh IssuerRegistry would be trusted by nobody.
        if (envEligibilityGate != address(0)) {
            require(envIssuerRegistry != address(0), "ELIGIBILITY_GATE needs ISSUER_REGISTRY (the gate's registry is immutable)");
            require(
                address(EligibilityGate(envEligibilityGate).issuers()) == envIssuerRegistry,
                "ELIGIBILITY_GATE reads a different IssuerRegistry than ISSUER_REGISTRY"
            );
        }
        if (envIdentityFactory != address(0)) {
            require(envIssuerRegistry != address(0), "IDENTITY_FACTORY needs ISSUER_REGISTRY (the factory's registry is immutable)");
            require(
                IdentityFactory(envIdentityFactory).issuerRegistry() == envIssuerRegistry,
                "IDENTITY_FACTORY reads a different IssuerRegistry than ISSUER_REGISTRY"
            );
        }
        // Every claim in this script is signed with OPERATOR_PK; an issuer that does not
        // authorize it would reject each one at submitClaim.
        if (envClaimIssuer != address(0)) {
            require(
                ClaimIssuer(envClaimIssuer).isAuthorizedSigner(operator),
                "CLAIM_ISSUER does not authorize the operator as a signer - set OPERATOR_PK to the issuer signer key"
            );
        }

        _preflightTokens();
        _preflightHooks();
    }

    /// The pair is all-or-nothing, and the house has to settle in one of the two.
    function _preflightTokens() internal view {
        if (envTokenA == address(0) && envTokenB == address(0)) {
            require(envSpendToken == address(0), "SPEND_TOKEN needs TOKEN_A + TOKEN_B (the fresh mUSD mock is used otherwise)");
            return;
        }
        require(envTokenA != address(0) && envTokenB != address(0), "set both TOKEN_A and TOKEN_B, or neither");
        require(envTokenA != envTokenB, "TOKEN_A and TOKEN_B must differ");
        require(
            envSpendToken == envTokenA || envSpendToken == envTokenB,
            "set SPEND_TOKEN to TOKEN_A or TOKEN_B - the house settles in it and the web reads it as token0 or token1"
        );
    }

    /// A ComplianceHook's manager, gate, resolver and policy are all immutable, so a reused
    /// hook dictates the rest of the world rather than adapting to it. Check, don't hope.
    function _preflightHooks() internal view {
        if (envDealHook == address(0) && envInvestorHook == address(0)) return;
        require(
            envEligibilityGate != address(0) && envIdentityFactory != address(0) && envPoolManager != address(0),
            "DEAL_HOOK/INVESTOR_HOOK need ELIGIBILITY_GATE + IDENTITY_FACTORY + POOL_MANAGER (a hook's wiring is immutable)"
        );
        _requireHookWiring(envDealHook, POLICY_DEAL_ROOM, "DEAL_HOOK");
        _requireHookWiring(envInvestorHook, POLICY_INVESTOR, "INVESTOR_HOOK");
    }

    function _requireHookWiring(address hook, uint256 policyId, string memory name) internal view {
        if (hook == address(0)) return;
        require(address(ComplianceHook(hook).poolManager()) == envPoolManager, string.concat(name, " points at another PoolManager"));
        require(address(ComplianceHook(hook).gate()) == envEligibilityGate, string.concat(name, " points at another EligibilityGate"));
        require(address(ComplianceHook(hook).resolver()) == envIdentityFactory, string.concat(name, " points at another IdentityFactory"));
        require(ComplianceHook(hook).policyId() == policyId, string.concat(name, " enforces a different policy id"));
    }

    function _requireCode(address addr, string memory name) internal view {
        if (addr == address(0)) return;
        require(addr.code.length > 0, string.concat(name, " has no code on this chain"));
    }

    // --- Gas for the actors (public chains only) -----------------------------------

    /**
     * Model B means the HOLDER signs: ana submits her own claim, every actor sets its own
     * approvals, and the demo runtime then swaps from their wallets. On anvil those accounts
     * are pre-funded with 10_000 ETH; on a public chain they are empty EOAs and the operator
     * is the only one holding anything, so it tops each of them up to a floor. Topping up to
     * a floor (rather than sending a fixed amount) keeps a re-run from draining the operator.
     */
    function _fundGas() internal {
        if (block.chainid == 31337 || actorEthFloor == 0) return;
        vm.startBroadcast(OPERATOR_PK);
        _drip(ana);
        _drip(rui);
        _drip(concierge);
        _drip(plumber);
        vm.stopBroadcast();
    }

    function _drip(address wallet) internal {
        if (wallet.balance >= actorEthFloor) return;
        (bool ok,) = wallet.call{ value: actorEthFloor - wallet.balance }("");
        require(ok, "ETH drip failed - fund the operator, or lower ACTOR_ETH_WEI");
    }

    // --- PassportKit stack (deployed once, shared by every surface) ---

    function _deployStack() internal {
        issuerRegistry = envIssuerRegistry != address(0)
            ? IssuerRegistry(envIssuerRegistry)
            : new IssuerRegistry(operator);
        claimIssuer = envClaimIssuer != address(0)
            ? ClaimIssuer(envClaimIssuer)
            : new ClaimIssuer(operator, operator); // the operator key is the EIP-712 signer
        identityFactory = envIdentityFactory != address(0)
            ? IdentityFactory(envIdentityFactory)
            : new IdentityFactory(operator, address(issuerRegistry));
        eligibilityGate = envEligibilityGate != address(0)
            ? EligibilityGate(envEligibilityGate)
            : new EligibilityGate(operator, address(issuerRegistry));

        _ensureTrusted(ClaimTopics.KYC_VERIFIED);
        _ensureTrusted(ClaimTopics.ACCREDITED_INVESTOR);

        uint256[] memory dealTopics = new uint256[](1);
        dealTopics[0] = ClaimTopics.KYC_VERIFIED;
        _ensurePolicy(POLICY_DEAL_ROOM, dealTopics);

        uint256[] memory investorTopics = new uint256[](2);
        investorTopics[0] = ClaimTopics.KYC_VERIFIED;
        investorTopics[1] = ClaimTopics.ACCREDITED_INVESTOR;
        _ensurePolicy(POLICY_INVESTOR, investorTopics);
    }

    /// setTrusted already no-ops on a repeat, but the read is free and the transaction is not.
    function _ensureTrusted(uint256 topic) internal {
        if (issuerRegistry.isTrusted(address(claimIssuer), topic)) return;
        issuerRegistry.setTrusted(address(claimIssuer), topic, true);
    }

    /// Re-wiring a policy that is already exactly right is pure noise on a live chain — and
    /// it needs DEFAULT_ADMIN_ROLE, which a reused gate may not grant us.
    function _ensurePolicy(uint256 policyId, uint256[] memory topics) internal {
        if (_policyMatches(policyId, topics)) return;
        eligibilityGate.setPolicy(policyId, topics);
    }

    /// @dev Exact match, in order and in length. `policyTopics(policyId, i)` is the public
    ///      getter of a dynamic array, so an index past the end reverts (Panic 0x32) — which
    ///      is precisely how "unset" and "shorter than we want" announce themselves.
    function _policyMatches(uint256 policyId, uint256[] memory topics) internal view returns (bool) {
        for (uint256 i; i < topics.length; ++i) {
            try eligibilityGate.policyTopics(policyId, i) returns (uint256 got) {
                if (got != topics[i]) return false;
            } catch {
                return false;
            }
        }
        try eligibilityGate.policyTopics(policyId, topics.length) returns (uint256) {
            return false; // longer than we want: a stricter policy than this world assumes
        } catch {
            return true;
        }
    }

    /// One identity per person. The operator clears both policies so it can seed liquidity;
    /// ana's KYC lands from her own wallet after this broadcast block; rui starts bare.
    /// The concierge and the plumber get no identity at all.
    function _onboardActors() internal {
        operatorIdentity = _ensureIdentity(operator);
        anaIdentity = _ensureIdentity(ana);
        ruiIdentity = _ensureIdentity(rui);

        _ensureOwnClaim(operatorIdentity, ClaimTopics.KYC_VERIFIED);
        _ensureOwnClaim(operatorIdentity, ClaimTopics.ACCREDITED_INVESTOR);
    }

    /// createIdentity reverts with IdentityExists, so a re-run has to ask first.
    function _ensureIdentity(address wallet) internal returns (address) {
        address existing = identityFactory.identityOfWallet(wallet);
        if (existing != address(0)) return existing;
        return identityFactory.createIdentity(wallet);
    }

    /// Signs (issuer) and submits (holder) in one call — only valid while broadcasting as the
    /// holder, which for the operator's own identity it always is.
    function _ensureOwnClaim(address identity, uint256 topic) internal {
        if (_claimIsValid(identity, topic)) return;
        _unlatch(identity, topic);
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
    }

    /// Same, for a holder who is not the current broadcaster: two wallets, two transactions.
    function _ensureHolderClaim(uint256 holderPk, address identity, uint256 topic) internal {
        if (_claimIsValid(identity, topic)) return;
        if (claimIssuer.revoked(identity, topic)) {
            vm.startBroadcast(OPERATOR_PK);
            _unlatch(identity, topic);
            vm.stopBroadcast();
        }
        (bytes memory sig, bytes memory data) = _signClaim(identity, topic);
        vm.startBroadcast(holderPk);
        Identity(identity).submitClaim(topic, address(claimIssuer), sig, data);
        vm.stopBroadcast();
    }

    /// @dev The revocation latch also blocks WRITES (submitClaim re-checks isClaimValid), so a
    ///      previously revoked identity can only be re-verified by the issuer re-opening it
    ///      first. This script defines the STARTING state, in which nobody is revoked yet —
    ///      the demo does the revoking. Must be broadcast by the issuer (AGENT_ROLE).
    function _unlatch(address identity, uint256 topic) internal {
        if (!claimIssuer.revoked(identity, topic)) return;
        claimIssuer.setRevoked(identity, topic, false);
    }

    /// The exact question the gate asks: is there a claim from OUR issuer that still verifies?
    function _claimIsValid(address identity, uint256 topic) internal view returns (bool) {
        (bool exists, bytes memory sig, bytes memory data) = Identity(identity).getClaim(topic, address(claimIssuer));
        return exists && claimIssuer.isClaimValid(identity, topic, sig, data);
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
        poolManager = envPoolManager != address(0) ? PoolManager(envPoolManager) : new PoolManager(operator);
        // The routers are always fresh: DemoPositionRouter keys every position by its own
        // caller, so the demo can only ever REMOVE liquidity it added through this router.
        swapRouter = new PoolSwapTest(poolManager);
        liquidityRouter = new DemoPositionRouter(poolManager);

        _resolveTokens();

        IERC20(token0).approve(address(swapRouter), type(uint256).max);
        IERC20(token1).approve(address(swapRouter), type(uint256).max);
        IERC20(token0).approve(address(liquidityRouter), type(uint256).max);
        IERC20(token1).approve(address(liquidityRouter), type(uint256).max);

        // Ana tops the house up with the settlement token during the demo, on top of the
        // trading balance _fundActor gives her.
        IERC20(musd).transfer(ana, ACTOR_TOKENS);
    }

    /**
     * Bring your own pair, or get the PROP + mUSD mocks. Reused tokens are never minted —
     * only transferred out of the operator's existing balance — so the pair does not have to
     * be an open-mint mock. The operator must therefore already hold enough of both.
     */
    function _resolveTokens() internal {
        address a = envTokenA;
        address b = envTokenB;

        if (a == address(0)) {
            MockERC20 prop = new MockERC20("Property Share", "PROP", 18);
            MockERC20 stable = new MockERC20("Mock USD", "mUSD", 18);
            prop.mint(operator, OPERATOR_TOKENS);
            stable.mint(operator, OPERATOR_TOKENS);
            (a, b) = (address(prop), address(stable));
            musd = address(stable);
        } else {
            musd = envSpendToken; // checked to be one of the pair in _preflightTokens
        }

        (token0, token1) = a < b ? (a, b) : (b, a);
    }

    function _deployComplianceHooks() internal {
        dealHook = envDealHook != address(0)
            ? ComplianceHook(envDealHook)
            : _deployComplianceHook(POLICY_DEAL_ROOM);
        investorHook = envInvestorHook != address(0)
            ? ComplianceHook(envInvestorHook)
            : _deployComplianceHook(POLICY_INVESTOR);

        _createCompliancePool(dealHook);
        _createCompliancePool(investorHook);
    }

    function _deployComplianceHook(uint256 policyId) internal returns (ComplianceHook hook) {
        // No bootstrap LP: the operator is fully verified above, so it seeds through the gate.
        bytes memory args = abi.encode(poolManager, eligibilityGate, identityFactory, policyId, address(0));
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, HOOK_FLAGS, type(ComplianceHook).creationCode, args);
        hook = new ComplianceHook{ salt: salt }(
            poolManager,
            IEligibilityGate(address(eligibilityGate)),
            IIdentityResolver(address(identityFactory)),
            policyId,
            address(0)
        );
        require(address(hook) == hookAddress, "compliance hook address mismatch");
    }

    /// A reused hook usually comes with a pool that DeployHooks already opened on this very
    /// pair — initializing it again reverts. Liquidity is always added, though: the demo's
    /// "remove liquidity" only works on positions this run's router owns.
    function _createCompliancePool(ComplianceHook hook) internal {
        PoolKey memory key = PoolKey(
            Currency.wrap(token0), Currency.wrap(token1), FEE, TICK_SPACING, IHooks(address(hook))
        );
        if (!_isInitialized(key)) poolManager.initialize(key, SQRT_PRICE_1_1);
        liquidityRouter.modifyLiquidity(
            key,
            TickMath.minUsableTick(TICK_SPACING),
            TickMath.maxUsableTick(TICK_SPACING),
            10_000e18,
            abi.encode(operator)
        );
    }

    function _isInitialized(PoolKey memory key) internal view returns (bool) {
        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(IPoolManager(address(poolManager)), PoolIdLibrary.toId(key));
        return sqrtPriceX96 != 0;
    }

    // --- The house: treasury, mandate, CASA/mUSD pool ---

    function _deployHouse() internal {
        require(
            IERC20(musd).balanceOf(operator) >= HOUSE_DEPOSIT,
            "operator holds less of SPEND_TOKEN than the house deposit"
        );

        address[] memory owners = new address[](2);
        owners[0] = operator;
        owners[1] = ana;
        treasury = new HouseTreasury(
            owners,
            2,
            IERC20(musd),
            /* the house reuses the very same gate + resolver as the pools */
            IHouseGate(address(eligibilityGate)),
            IHouseResolver(address(identityFactory)),
            POLICY_DEAL_ROOM,
            "Casa Azul Scrip",
            "CASA"
        );
        casa = treasury.HOUSE_TOKEN();

        IERC20(musd).approve(address(treasury), HOUSE_DEPOSIT);
        treasury.deposit(HOUSE_DEPOSIT);

        treasury.grantMandate(concierge, 200 ether, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(500 ether);

        _deployMandateHook();
    }

    function _deployMandateHook() internal {
        bytes memory args = abi.encode(poolManager, treasury);
        (address hookAddress, bytes32 salt) =
            HookMiner.find(CREATE2_FACTORY, HOOK_FLAGS, type(MandateHook).creationCode, args);
        mandateHook = new MandateHook{ salt: salt }(poolManager, IHouseTreasuryStanding(address(treasury)));
        require(address(mandateHook) == hookAddress, "mandate hook address mismatch");

        (Currency currency0, Currency currency1) = address(casa) < musd
            ? (Currency.wrap(address(casa)), Currency.wrap(musd))
            : (Currency.wrap(musd), Currency.wrap(address(casa)));
        housePoolKey = PoolKey(currency0, currency1, FEE, TICK_SPACING, IHooks(address(mandateHook)));
        // The treasury is always fresh, so its mandate hook is mined to an address nothing
        // has ever used — this pool cannot already exist.
        poolManager.initialize(housePoolKey, SQRT_PRICE_1_1);
    }

    /// @dev Ordering trap: MandateHook.beforeAddLiquidity demands isCompliantOwner(operator),
    ///      which is isOwner AND live-eligible on POLICY_DEAL_ROOM. The operator's KYC claim
    ///      therefore has to land in _onboardActors BEFORE this runs.
    function _seedHouseLiquidity() internal {
        // Temporary-mandate trick: mint seed CASA to the operator so it can LP, then
        // restore the concierge's real mandate.
        treasury.grantMandate(operator, 0, uint64(block.timestamp + 365 days));
        treasury.fundConcierge(HOUSE_SEED_CASA); // mints to operator (current mandate agent)
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

    /// Transfers, not mints: the pair may be a pre-existing token nobody can mint.
    function _fundActor(uint256 pk) internal {
        address wallet = vm.addr(pk);
        vm.startBroadcast(OPERATOR_PK);
        IERC20(token0).transfer(wallet, ACTOR_TOKENS);
        IERC20(token1).transfer(wallet, ACTOR_TOKENS);
        vm.stopBroadcast();

        vm.startBroadcast(pk);
        IERC20(token0).approve(address(swapRouter), type(uint256).max);
        IERC20(token1).approve(address(swapRouter), type(uint256).max);
        IERC20(token0).approve(address(liquidityRouter), type(uint256).max);
        IERC20(token1).approve(address(liquidityRouter), type(uint256).max);
        vm.stopBroadcast();
    }

    /// Ana can top the house up; the concierge can liquify its CASA budget.
    function _approveHouseActors() internal {
        vm.startBroadcast(ANA_PK);
        IERC20(musd).approve(address(treasury), type(uint256).max);
        vm.stopBroadcast();

        vm.startBroadcast(CONCIERGE_PK);
        casa.approve(address(swapRouter), type(uint256).max);
        IERC20(musd).approve(address(swapRouter), type(uint256).max);
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
            '  "token0": "', vm.toString(token0), '",\n',
            '  "token0Symbol": "', IERC20Metadata(token0).symbol(), '",\n',
            '  "token1": "', vm.toString(token1), '",\n',
            '  "token1Symbol": "', IERC20Metadata(token1).symbol(), '",\n',
            '  "dealHook": "', vm.toString(address(dealHook)), '",\n',
            '  "investorHook": "', vm.toString(address(investorHook)), '",\n'
        );
        json = string.concat(
            json,
            '  "treasury": "', vm.toString(address(treasury)), '",\n',
            '  "mandateHook": "', vm.toString(address(mandateHook)), '",\n',
            '  "casa": "', vm.toString(address(casa)), '",\n',
            '  "musd": "', vm.toString(musd), '",\n',
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

    /// "(reused)" marks what came from env — the fastest way to confirm a reuse run really
    /// reused rather than quietly redeployed.
    function _log() internal view {
        console.log("IssuerRegistry:     ", address(issuerRegistry), _tag(envIssuerRegistry));
        console.log("ClaimIssuer:        ", address(claimIssuer), _tag(envClaimIssuer));
        console.log("IdentityFactory:    ", address(identityFactory), _tag(envIdentityFactory));
        console.log("EligibilityGate:    ", address(eligibilityGate), _tag(envEligibilityGate));
        console.log("PoolManager:        ", address(poolManager), _tag(envPoolManager));
        console.log("token0:             ", token0, _tag(envTokenA == address(0) ? address(0) : token0));
        console.log("token1:             ", token1, _tag(envTokenB == address(0) ? address(0) : token1));
        console.log("spend token (musd): ", musd);
        console.log("Deal hook:          ", address(dealHook), _tag(envDealHook));
        console.log("Investor hook:      ", address(investorHook), _tag(envInvestorHook));
        console.log("HouseTreasury:      ", address(treasury));
        console.log("MandateHook:        ", address(mandateHook));
        console.log("CASA:               ", address(casa));
        console.log("addresses ->         apps/web/demo-addresses.json");
    }

    function _tag(address fromEnv) internal pure returns (string memory) {
        return fromEnv == address(0) ? "" : "(reused)";
    }
}
