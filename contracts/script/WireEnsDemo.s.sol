// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {PassportResolver} from "../src/ens/PassportResolver.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

/**
 * Wire a live ENS demo on top of the deployed PassportKit contracts (Sepolia).
 *
 * Deploys a FRESH PassportResolver (so THIS script's key is the tenant controller and can bind
 * nodes — the main deploy set casaazul's controller to the SubnameRegistrar). Then: creates an
 * identity for the owner, signs+submits KYC + ACCREDITED claims (issuer signer = owner key), binds
 * `luiz.casaazul.eth` -> that identity (GREEN), links a demo agent + score, binds `bot.luiz.casaazul.eth`.
 *
 * After running, point casaazul.eth's resolver (ENSv2 app) at the FRESH resolver this prints, and:
 *   cast call <resolver> "text(bytes32,string)(string)" $(cast namehash luiz.casaazul.eth) "compliance.status"  -> GREEN
 *
 * Env: OWNER_PRIVATE_KEY (= deployer/agent/issuer-signer, 0xEc98...), RPC_URL. Run with --slow (7702).
 */
interface IFactory {
    function createIdentity(address wallet) external returns (address);
    function identityOfWallet(address wallet) external view returns (address);
    function linkAgent(address agentWallet, address personIdentity) external;
}

interface IIdentity {
    function submitClaim(uint256 topic, address issuer, bytes calldata sig, bytes calldata data)
        external
        returns (bytes32);
}

interface IScore {
    function setScore(address agent, uint256 score) external;
}

interface IGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

contract WireEnsDemo is Script {
    // --- deployed on Sepolia 2026-07-25 (see docs/DEPLOYMENTS.md) ---
    address constant FACTORY = 0x23504699EAcc1842d01998C0D57C53a2CF1638A0;
    address constant SCORE_REGISTRY = 0x010c452FEC23669Be2D076Efe0CAEEb28c82Aa6E;
    address constant GATE = 0x51574D5830461FD38022987621C7bdf3a996b8d1;
    address constant CLAIM_ISSUER = 0x56F97734cC4d80af950538eAA6976398b5E58Fa9;

    uint256 constant DEAL_ROOM_POLICY = 1;
    address constant DEMO_AGENT = 0x000000000000000000000000000000000000a6E1;

    bytes32 constant CLAIM_TYPEHASH =
        keccak256("Claim(address identity,uint256 topic,bytes32 dataHash,uint64 expiresAt,bytes32 nonce)");
    bytes32 constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function run() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(pk);

        // namehash(casaazul.eth) — the tenant node
        bytes32 ethNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        bytes32 parentNode = keccak256(abi.encodePacked(ethNode, keccak256("casaazul")));
        bytes32 luizNode = keccak256(abi.encodePacked(parentNode, keccak256("luiz")));
        bytes32 botNode = keccak256(abi.encodePacked(luizNode, keccak256("bot")));

        vm.startBroadcast(pk);

        // 1. Fresh resolver we control (constructor: factory, scoreRegistry).
        PassportResolver resolver = new PassportResolver(FACTORY, SCORE_REGISTRY);

        // 2. Identity for the owner (idempotent).
        address identity = IFactory(FACTORY).identityOfWallet(owner);
        if (identity == address(0)) {
            identity = IFactory(FACTORY).createIdentity(owner);
        }

        // 3. Sign + submit KYC + ACCREDITED (owner holds the management key, so it may submit).
        _submitClaim(pk, identity, ClaimTopics.KYC_VERIFIED, "demo-kyc");
        _submitClaim(pk, identity, ClaimTopics.ACCREDITED_INVESTOR, "demo-accredited");

        // 4. Tenant (owner = controller so we can bind) + bind luiz.casaazul.eth -> identity.
        resolver.setTenant(parentNode, GATE, DEAL_ROOM_POLICY, owner);
        resolver.setIdentity(luizNode, parentNode, identity);

        // 5. Agent (Model A) + demo score + bind bot.luiz.casaazul.eth.
        if (IFactory(FACTORY).identityOfWallet(DEMO_AGENT) == address(0)) {
            IFactory(FACTORY).linkAgent(DEMO_AGENT, identity);
        }
        IScore(SCORE_REGISTRY).setScore(DEMO_AGENT, 87);
        resolver.setIdentity(botNode, parentNode, identity);

        vm.stopBroadcast();

        // --- confirmations (read against the resulting state) ---
        (bool ok,) = IGate(GATE).isEligible(identity, DEAL_ROOM_POLICY);
        console2.log("FRESH PassportResolver     ", address(resolver));
        console2.log("identity                   ", identity);
        console2.log("dealRoom eligible          ", ok);
        console2.log("luiz.casaazul.eth status   ", resolver.text(luizNode, "compliance.status"));
        console2.log("bot agent-registration     ", resolver.text(botNode, resolver.agentRegistrationKey(DEMO_AGENT)));
        console2.log("bot agent.reputation       ", resolver.text(botNode, resolver.agentReputationKey(DEMO_AGENT)));
        console2.log("--- point casaazul.eth resolver (ENSv2 app) at the FRESH resolver above ---");
    }

    function _submitClaim(uint256 signerKey, address identity, uint256 topic, string memory tag) internal {
        bytes32 dataHash = keccak256(abi.encodePacked("passportkit:", tag));
        uint64 expiresAt = 0; // no expiry
        bytes32 nonce = keccak256(abi.encode(identity, topic, tag));

        bytes32 domainSep = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PassportKitClaim")),
                keccak256(bytes("1")),
                block.chainid,
                CLAIM_ISSUER
            )
        );
        bytes32 structHash = keccak256(abi.encode(CLAIM_TYPEHASH, identity, topic, dataHash, expiresAt, nonce));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes memory data = abi.encode(dataHash, expiresAt, nonce);

        IIdentity(identity).submitClaim(topic, CLAIM_ISSUER, sig, data);
    }
}
