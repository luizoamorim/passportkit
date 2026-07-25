// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IEligibilityGate {
    function isEligible(address identity, uint256 policyId) external view returns (bool, bytes32);
}

interface IIdentityLookup {
    function identityOfWallet(address wallet) external view returns (address);
}

/**
 * @title PassportResolver  (ENS surface - tenant-aware read-through)
 * @notice A custom ENS resolver whose text(node,key) is COMPUTED LIVE. Two live records:
 *         - `compliance.status`      -> NONE / GREEN / REVOKED (from the EligibilityGate)
 *         - `agent-registration[..]` -> ENSIP-25 attestation (from the IdentityFactory agent link)
 *         No setText, no keeper: revocation/unlink flips the name automatically.
 *
 * White-label / kit: one resolver serves N tenants. Each parentNode (a tenant's .eth) carries its
 * own (gate, policyId). So `alice.brandx.eth` and `bob.acme.eth` resolve against different gates
 * from the same contract.
 *
 * ENS calls `text(node, key)` off-chain (eth_call) -> the extra SLOADs cost the user nothing.
 *
 * ENSIP-25 (Verifiable Agent Identity): the record key `agent-registration[<registry>][<agentId>]`
 * returns "1" iff `<agentId>` (an agent wallet) is linked to THIS name's identity in the registry
 * (our IdentityFactory). We compute it live instead of a manual setText, so `linkAgent` makes the
 * attestation appear and `unlinkAgent` makes it disappear. `<registry>` is the ERC-7930 address of
 * the IdentityFactory (see `registry7930()`); `<agentId>` is the agent wallet as a 0x-hex string.
 */
contract PassportResolver {
    struct Tenant {
        IEligibilityGate gate;
        uint256 policyId;
        address controller;
    }

    /// @notice The agent registry (our IdentityFactory) used for ENSIP-25 verification. Immutable:
    ///         set at deploy (the factory is deployed before the resolver).
    IIdentityLookup public immutable identityFactory;

    mapping(bytes32 => Tenant) public tenantOf; // parentNode => tenant config
    mapping(bytes32 => address) public identityOf; // node => OnchainID
    mapping(bytes32 => bytes32) public parentOf; // node => parentNode

    event TenantSet(bytes32 indexed parentNode, address gate, uint256 policyId, address controller);
    event IdentitySet(bytes32 indexed node, bytes32 indexed parentNode, address identity);

    error NotController();
    error ZeroController();
    error ZeroFactory();

    constructor(address identityFactory_) {
        if (identityFactory_ == address(0)) revert ZeroFactory();
        identityFactory = IIdentityLookup(identityFactory_);
    }

    /// @notice A tenant registers their gate/policy for their parent name.
    ///         (auth: in production, restrict to the parent's ENS owner.)
    /// @dev Trust-on-first-use: the first set is open (the tenant's backend claims the
    ///      parentNode at onboarding); after that only the current controller can update.
    // NOTE: Production upgrade is full ENS-owner auth via NameWrapper.ownerOf(parentNode).
    function setTenant(bytes32 parentNode, address gate, uint256 policyId, address controller) external {
        if (controller == address(0)) revert ZeroController(); // zero controller would brick setIdentity
        Tenant storage existing = tenantOf[parentNode];
        if (existing.controller != address(0) && msg.sender != existing.controller) revert NotController();
        tenantOf[parentNode] = Tenant(IEligibilityGate(gate), policyId, controller);
        emit TenantSet(parentNode, gate, policyId, controller);
    }

    /// @notice Bind a subname node to an identity. Called by the tenant's controller/registrar.
    function setIdentity(bytes32 node, bytes32 parentNode, address identity) external {
        if (msg.sender != tenantOf[parentNode].controller) revert NotController();
        identityOf[node] = identity;
        parentOf[node] = parentNode;
        emit IdentitySet(node, parentNode, identity);
    }

    /// @notice ENS ITextResolver - computed live.
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        bytes32 k = keccak256(bytes(key));
        if (k == keccak256("compliance.status")) {
            address id = identityOf[node];
            Tenant memory t = tenantOf[parentOf[node]];
            if (id == address(0) || address(t.gate).code.length == 0) return "NONE";
            (bool ok,) = t.gate.isEligible(id, t.policyId);
            return ok ? "GREEN" : "REVOKED"; // flips automatically on revocation
        }
        if (k == keccak256("compliance.identity")) return _toHex(identityOf[node]);

        // ENSIP-25: agent-registration[<registry7930>][<agentWallet>] -> "1" if the agent is linked
        // to this name's identity. Computed live from the IdentityFactory (link/unlink flips it).
        string memory agentRec = _agentRegistrationValue(node, key);
        if (bytes(agentRec).length != 0) return agentRec;

        return "";
    }

    /// @notice The ERC-7930 interoperable address of the registry (our IdentityFactory) on this chain.
    ///         Layout: version(0x0001) | chainType(0x0000=eip155) | chainRefLen | chainRef | 0x14 | addr.
    ///         Exposed so clients build the exact same ENSIP-25 key the resolver matches.
    function registry7930() public view returns (string memory) {
        bytes memory chainRef = _minimalChainRef(block.chainid);
        bytes memory raw = abi.encodePacked(
            hex"0001", // version
            hex"0000", // chain type: eip155
            bytes1(uint8(chainRef.length)),
            chainRef,
            bytes1(uint8(20)), // address length
            bytes20(address(identityFactory))
        );
        return _bytesToHex(raw);
    }

    /// @notice The exact ENSIP-25 text-record key for an agent — single source of truth for clients.
    function agentRegistrationKey(address agent) public view returns (string memory) {
        return string(abi.encodePacked("agent-registration[", registry7930(), "][", _toHex(agent), "]"));
    }

    /// @dev Returns "1" if `key` is our agent-registration key for an agent linked to `node`'s identity,
    ///      else "" (wrong registry, malformed, unlinked, or unknown identity).
    function _agentRegistrationValue(bytes32 node, string calldata key) internal view returns (string memory) {
        bytes memory kb = bytes(key);
        bytes memory prefix = abi.encodePacked("agent-registration[", registry7930(), "][");
        // exact shape: prefix + "0x"+40hex (42) + "]" (1)
        if (kb.length != prefix.length + 43) return "";
        if (kb[kb.length - 1] != "]") return "";
        if (!_startsWith(kb, prefix)) return ""; // wrong registry or not an agent-registration key
        (address agent, bool ok) = _parseAddrAt(kb, prefix.length);
        if (!ok) return "";
        address personId = identityOf[node];
        if (personId != address(0) && identityFactory.identityOfWallet(agent) == personId) {
            return "1";
        }
        return "";
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x59d1d43c // ITextResolver.text(bytes32,string)
            || id == 0x01ffc9a7; // ERC-165
    }

    // --- string helpers (pure bytes work; text() is an off-chain eth_call) ---

    /// @dev Render an address as a lowercase 0x-prefixed hex string.
    function _toHex(address a) internal pure returns (string memory) {
        bytes memory hexchars = "0123456789abcdef";
        bytes memory out = new bytes(42);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < 20; ++i) {
            out[2 + i * 2] = hexchars[uint8(uint160(a) >> ((8 * (19 - i)) + 4)) & 0x0f];
            out[2 + i * 2 + 1] = hexchars[uint8(uint160(a) >> (8 * (19 - i))) & 0x0f];
        }
        return string(out);
    }

    function _bytesToHex(bytes memory raw) internal pure returns (string memory) {
        bytes memory hexchars = "0123456789abcdef";
        bytes memory out = new bytes(2 + raw.length * 2);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i; i < raw.length; ++i) {
            out[2 + i * 2] = hexchars[uint8(raw[i]) >> 4];
            out[2 + i * 2 + 1] = hexchars[uint8(raw[i]) & 0x0f];
        }
        return string(out);
    }

    /// @dev Minimal big-endian encoding of a chain id (>= 1 byte).
    function _minimalChainRef(uint256 id) internal pure returns (bytes memory) {
        if (id == 0) return hex"00";
        uint256 n;
        uint256 tmp = id;
        while (tmp != 0) {
            n++;
            tmp >>= 8;
        }
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[n - 1 - i] = bytes1(uint8(id >> (8 * i)));
        }
        return out;
    }

    function _startsWith(bytes memory s, bytes memory p) internal pure returns (bool) {
        if (s.length < p.length) return false;
        for (uint256 i; i < p.length; ++i) {
            if (s[i] != p[i]) return false;
        }
        return true;
    }

    /// @dev Parse "0x" + 40 hex chars at offset `off` into an address. Case-insensitive.
    function _parseAddrAt(bytes memory s, uint256 off) internal pure returns (address, bool) {
        if (off + 42 > s.length) return (address(0), false);
        if (s[off] != "0" || (s[off + 1] != "x" && s[off + 1] != "X")) return (address(0), false);
        uint160 acc;
        for (uint256 i; i < 40; ++i) {
            (uint8 v, bool ok) = _hexVal(uint8(s[off + 2 + i]));
            if (!ok) return (address(0), false);
            acc = acc * 16 + v;
        }
        return (address(acc), true);
    }

    function _hexVal(uint8 c) internal pure returns (uint8, bool) {
        if (c >= 48 && c <= 57) return (c - 48, true); // 0-9
        if (c >= 97 && c <= 102) return (c - 87, true); // a-f
        if (c >= 65 && c <= 70) return (c - 55, true); // A-F
        return (0, false);
    }
}
