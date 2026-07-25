// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/**
 * Register a .eth name on the CLASSIC (v1) ENS on Sepolia via commit-reveal. This uses the documented
 * v1 ETHRegistrarController, which WRAPS the name into the classic NameWrapper (0x0635...), so our
 * PassportSubnameRegistrar can mint real subnames (bot1.casaazul.eth).
 *
 * NOTE: the app.ens.domains Sepolia UI now registers into the ENSv2 testnet (different contracts) —
 * that's why casaazul.eth from the UI wasn't in the classic NameWrapper. This script registers it on
 * v1 instead. Run in TWO steps (the controller enforces a >=60s gap between commit and register):
 *
 *   export OWNER_PRIVATE_KEY=0x...            # funded with Sepolia ETH
 *   export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
 *   forge script script/RegisterEnsV1.s.sol --sig "commitTx()"   --rpc-url $RPC_URL --broadcast
 *   # wait ~70s
 *   forge script script/RegisterEnsV1.s.sol --sig "registerTx()" --rpc-url $RPC_URL --broadcast
 *
 * Override the label with LABEL=<name> (default "casaazul"). The secret is fixed so both steps match.
 */
interface IETHRegistrarController {
    function available(string calldata name) external view returns (bool);
    function rentPrice(string calldata name, uint256 duration)
        external
        view
        returns (uint256 base, uint256 premium);
    function makeCommitment(
        string calldata name,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses
    ) external view returns (bytes32);
    function commit(bytes32 commitment) external;
    function register(
        string calldata name,
        address owner,
        uint256 duration,
        bytes32 secret,
        address resolver,
        bytes[] calldata data,
        bool reverseRecord,
        uint16 ownerControlledFuses
    ) external payable;
}

contract RegisterEnsV1 is Script {
    IETHRegistrarController constant CONTROLLER =
        IETHRegistrarController(0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968);
    address constant PUBLIC_RESOLVER = 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5;
    bytes32 constant SECRET = keccak256("passportkit-casaazul-v1"); // fixed so commit == register
    uint256 constant DURATION = 365 days;
    uint16 constant FUSES = 0;

    function _label() internal view returns (string memory) {
        return vm.envOr("LABEL", string("casaazul"));
    }

    function commitTx() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        string memory label = _label();
        require(CONTROLLER.available(label), "name not available on classic ENS (v1)");
        bytes[] memory data = new bytes[](0);
        bytes32 commitment =
            CONTROLLER.makeCommitment(label, owner, DURATION, SECRET, PUBLIC_RESOLVER, data, false, FUSES);
        vm.startBroadcast(pk);
        CONTROLLER.commit(commitment);
        vm.stopBroadcast();
        console2.log("committed:", label);
        console2.log("wait ~70s, then run: --sig registerTx()");
    }

    function registerTx() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        string memory label = _label();
        bytes[] memory data = new bytes[](0);
        (uint256 base, uint256 premium) = CONTROLLER.rentPrice(label, DURATION);
        uint256 price = base + premium;
        uint256 value = price + price / 20; // +5% buffer; the controller refunds any excess
        vm.startBroadcast(pk);
        CONTROLLER.register{value: value}(
            label, owner, DURATION, SECRET, PUBLIC_RESOLVER, data, false, FUSES
        );
        vm.stopBroadcast();
        console2.log("registered on v1 (wrapped in NameWrapper 0x0635):", label);
        console2.log("owner:", owner);
    }
}
