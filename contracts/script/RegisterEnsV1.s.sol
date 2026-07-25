// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/**
 * Register a .eth name on the CLASSIC (v1) ENS on Sepolia via commit-reveal. Uses the deployed
 * ETHRegistrarController (0xfb3cE5...), which WRAPS the name into NameWrapper (0x0635...) so our
 * PassportSubnameRegistrar can mint real subnames.
 *
 * The current controller takes a single Registration STRUCT (reverseRecord is uint8, plus a bytes32
 * referrer) — not positional args. Run in two steps (>=60s gap):
 *
 *   export OWNER_PRIVATE_KEY=0x...            # funded with Sepolia ETH
 *   export RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
 *   forge script script/RegisterEnsV1.s.sol --sig "commitTx()"   --rpc-url $RPC_URL --broadcast --skip 'src/hooks/*' --skip 'src/demo/*' --skip 'test/*'
 *   # wait ~75s
 *   forge script script/RegisterEnsV1.s.sol --sig "registerTx()" --rpc-url $RPC_URL --broadcast --skip 'src/hooks/*' --skip 'src/demo/*' --skip 'test/*'
 *
 * Override the label with LABEL=<name> (default "casaazul"). The secret is fixed so both steps match.
 */
interface IETHRegistrarController {
    struct Registration {
        string label;
        address owner;
        uint256 duration;
        bytes32 secret;
        address resolver;
        bytes[] data;
        uint8 reverseRecord;
        bytes32 referrer;
    }

    function available(string calldata name) external view returns (bool);
    function rentPrice(string calldata name, uint256 duration)
        external
        view
        returns (uint256 base, uint256 premium);
    function makeCommitment(Registration calldata registration) external view returns (bytes32);
    function commit(bytes32 commitment) external;
    function register(Registration calldata registration) external payable;
}

contract RegisterEnsV1 is Script {
    IETHRegistrarController constant CONTROLLER =
        IETHRegistrarController(0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968);
    address constant PUBLIC_RESOLVER = 0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5;
    bytes32 constant SECRET = keccak256("passportkit-casaazul-v1"); // fixed so commit == register
    uint256 constant DURATION = 365 days;

    function _label() internal view returns (string memory) {
        return vm.envOr("LABEL", string("casaazul"));
    }

    /// Build the SAME Registration for commit and register (so the commitment matches).
    function _reg(string memory label, address owner)
        internal
        pure
        returns (IETHRegistrarController.Registration memory)
    {
        return IETHRegistrarController.Registration({
            label: label,
            owner: owner,
            duration: DURATION,
            secret: SECRET,
            resolver: PUBLIC_RESOLVER,
            data: new bytes[](0),
            reverseRecord: 0, // 0 = don't set a reverse record
            referrer: bytes32(0)
        });
    }

    function commitTx() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        string memory label = _label();
        require(CONTROLLER.available(label), "name not available on classic ENS (v1)");
        bytes32 commitment = CONTROLLER.makeCommitment(_reg(label, owner));
        vm.startBroadcast(pk);
        CONTROLLER.commit(commitment);
        vm.stopBroadcast();
        console2.log("committed:", label);
        console2.log("wait ~75s, then run: --sig registerTx()");
    }

    function registerTx() external {
        uint256 pk = vm.envUint("OWNER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        string memory label = _label();
        (uint256 base, uint256 premium) = CONTROLLER.rentPrice(label, DURATION);
        uint256 value = (base + premium) * 105 / 100; // +5% buffer; controller refunds excess
        vm.startBroadcast(pk);
        CONTROLLER.register{value: value}(_reg(label, owner));
        vm.stopBroadcast();
        console2.log("registered on v1 (wrapped in NameWrapper 0x0635):", label);
        console2.log("owner:", owner);
    }
}
