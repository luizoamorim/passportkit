// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IssuerRegistry} from "../src/IssuerRegistry.sol";
import {ClaimIssuer} from "../src/ClaimIssuer.sol";
import {EligibilityGate} from "../src/EligibilityGate.sol";
import {IdentityFactory} from "../src/IdentityFactory.sol";
import {GatedERC20} from "../src/GatedERC20.sol";
import {PassportResolver} from "../src/ens/PassportResolver.sol";
import {PassportSubnameRegistrar} from "../src/ens/PassportSubnameRegistrar.sol";
import {ClaimTopics} from "../src/libraries/Types.sol";

/**
 * Deploy + wire the PassportKit stack on Ethereum Sepolia.
 *
 * Roles:
 *   - deployer (DEPLOYER_PRIVATE_KEY) = admin of IssuerRegistry + EligibilityGate (so this script
 *     can wire setTrusted / setPolicy at deploy time).
 *   - agent (AGENT_ADDRESS, defaults to deployer) = the backend's on-chain key: AGENT_ROLE on
 *     ClaimIssuer (setRevoked) + IdentityFactory (createIdentity), MINTER_ROLE on GatedERC20,
 *     ISSUER_ROLE on the SubnameRegistrar.
 *   - signer (ISSUER_SIGNER_ADDRESS, defaults to deployer) = the ClaimIssuer's authorized EIP-712 signer.
 *
 * Env: DEPLOYER_PRIVATE_KEY, AGENT_ADDRESS?, ISSUER_SIGNER_ADDRESS?, ENS_NAMEWRAPPER_ADDRESS?,
 *      ENS_PARENT_NODE? (namehash of the tenant's .eth — if set, wires the resolver tenant).
 * Run: forge script script/DeployPassportKit.s.sol --rpc-url $RPC_URL --broadcast --verify
 *
 * NOTE: agent-identity (linkAgent/unlinkAgent, branch feature/agent-identity-x402) is NOT on develop
 *       yet — add its deploy/wiring here once it merges.
 */
contract DeployPassportKit is Script {
    // ENS NameWrapper on Ethereum Sepolia (official) — used if ENS_NAMEWRAPPER_ADDRESS is unset.
    address internal constant SEPOLIA_NAME_WRAPPER = 0x0635513f179D50A207757E05759CbD106d7dFcE8;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address agent = vm.envOr("AGENT_ADDRESS", deployer);
        address signer = vm.envOr("ISSUER_SIGNER_ADDRESS", deployer);
        address nameWrapper = vm.envOr("ENS_NAMEWRAPPER_ADDRESS", SEPOLIA_NAME_WRAPPER);
        bytes32 parentNode = vm.envOr("ENS_PARENT_NODE", bytes32(0));

        vm.startBroadcast(deployerKey);

        // 1. Issuer trust layer
        IssuerRegistry registry = new IssuerRegistry(deployer); // deployer=admin so we can setTrusted here
        ClaimIssuer issuer = new ClaimIssuer(agent, signer); // agent=AGENT_ROLE (setRevoked); signer authorized
        registry.setTrusted(address(issuer), ClaimTopics.KYC_VERIFIED, true);
        registry.setTrusted(address(issuer), ClaimTopics.PROOF_OF_PERSONHOOD, true);
        registry.setTrusted(address(issuer), ClaimTopics.ACCREDITED_INVESTOR, true);

        // 2. Gate + policies
        EligibilityGate gate = new EligibilityGate(deployer, address(registry));
        uint256[] memory dealRoom = new uint256[](1);
        dealRoom[0] = ClaimTopics.KYC_VERIFIED;
        gate.setPolicy(1, dealRoom); // policy #1 = Deal Room (KYC only)
        uint256[] memory investor = new uint256[](2);
        investor[0] = ClaimTopics.KYC_VERIFIED;
        investor[1] = ClaimTopics.ACCREDITED_INVESTOR;
        gate.setPolicy(2, investor); // policy #2 = investor (KYC + accredited)

        // 3. Identity factory (agent creates identities)
        IdentityFactory factory = new IdentityFactory(agent, address(registry));

        // 4. Surfaces
        //    GatedERC20's "resolver" is the IdentityFactory (wallet -> identity); policy #1 (KYC).
        GatedERC20 token =
            new GatedERC20("PassportKit Demo", "PKD", address(gate), address(factory), 1, agent);
        PassportResolver resolver = new PassportResolver();
        PassportSubnameRegistrar subnames =
            new PassportSubnameRegistrar(nameWrapper, address(resolver), agent);

        // 5. ENS tenant wiring (only if a parent node is provided).
        //    controller = the registrar so it can bind subnames via resolver.setIdentity.
        if (parentNode != bytes32(0)) {
            resolver.setTenant(parentNode, address(gate), 1, address(subnames));
        }

        vm.stopBroadcast();

        // --- address table (copy into .env / README) ---
        console2.log("IssuerRegistry            ", address(registry));
        console2.log("ClaimIssuer               ", address(issuer));
        console2.log("EligibilityGate           ", address(gate));
        console2.log("IdentityFactory           ", address(factory));
        console2.log("GatedERC20                ", address(token));
        console2.log("PassportResolver          ", address(resolver));
        console2.log("PassportSubnameRegistrar  ", address(subnames));
        console2.log("--- roles ---");
        console2.log("admin (registry, gate)    ", deployer);
        console2.log("agent (issuer/factory/token/subnames)", agent);
        console2.log("issuer signer             ", signer);
        // POST-DEPLOY (manual, needs the ENS name owner wallet):
        //   NameWrapper.setApprovalForAll(subnames, true)  -> lets the registrar mint subnames under the name
    }
}
