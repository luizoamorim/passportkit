// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAccessGate} from "../interfaces/IAccessGate.sol";
import {HouseToken} from "./HouseToken.sol";

/**
 * @title HouseTreasury
 * @notice Governance spine of a house: owners, the concierge's mandate, the
 *         above-threshold approval queue, and funding of the concierge's CASA budget.
 *
 * The concierge never holds a passport. Its authority derives from the owners:
 * isAgentInGoodStanding re-checks every owner against AccessGate live, so revoking
 * one owner's KYC instantly cuts the agent off everywhere this view is consulted.
 */
contract HouseTreasury {
    using SafeERC20 for IERC20;

    error NotOwner();
    error NotAgent();
    error NoMandate();
    error ZeroAddress();
    error BadThreshold();
    error UnknownPayment();
    error AlreadyApproved();
    error AlreadyExecuted();
    error ThresholdNotMet();

    event MandateGranted(address indexed agent, uint256 perTxCap, uint64 expiresAt);
    event MandateRevoked(address indexed agent);
    event ConciergeFunded(address indexed agent, uint256 amount);
    event Deposited(address indexed from, uint256 amount);
    event PaymentProposed(uint256 indexed id, address indexed vendor, uint256 amount, bytes32 evidenceHash);
    event PaymentApproved(uint256 indexed id, address indexed owner, uint256 approvals);
    event PaymentExecuted(uint256 indexed id, address indexed vendor, uint256 amount);

    struct Mandate {
        address agent;
        uint256 perTxCap;
        uint64 expiresAt;
        bool revoked;
    }

    struct PendingPayment {
        address vendor;
        uint256 amount;
        bytes32 evidenceHash;
        uint256 approvals;
        bool executed;
    }

    IERC20 public immutable SPEND_TOKEN;
    IAccessGate public immutable ACCESS_GATE;
    HouseToken public immutable HOUSE_TOKEN;

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable APPROVAL_THRESHOLD;

    Mandate public mandate;
    uint256 public nextPaymentId = 1;
    mapping(uint256 => PendingPayment) public payments;
    mapping(uint256 => mapping(address => bool)) public approvedBy;

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(
        address[] memory owners_,
        uint256 approvalThreshold_,
        IERC20 spendToken,
        IAccessGate gate,
        string memory tokenName,
        string memory tokenSymbol
    ) {
        if (owners_.length == 0) revert ZeroAddress();
        if (approvalThreshold_ == 0 || approvalThreshold_ > owners_.length) revert BadThreshold();
        for (uint256 i = 0; i < owners_.length; i++) {
            if (owners_[i] == address(0)) revert ZeroAddress();
            owners.push(owners_[i]);
            isOwner[owners_[i]] = true;
        }
        APPROVAL_THRESHOLD = approvalThreshold_;
        SPEND_TOKEN = spendToken;
        ACCESS_GATE = gate;
        HOUSE_TOKEN = new HouseToken(tokenName, tokenSymbol, address(this));
    }

    // --- Mandate ---

    /// @notice Any single owner grants/revokes — revoke is a fast brake by design;
    ///         single-owner grant is a stated hackathon simplification.
    function grantMandate(address agent, uint256 perTxCap, uint64 expiresAt) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        mandate = Mandate({ agent: agent, perTxCap: perTxCap, expiresAt: expiresAt, revoked: false });
        emit MandateGranted(agent, perTxCap, expiresAt);
    }

    function revokeMandate() external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        mandate.revoked = true;
        emit MandateRevoked(mandate.agent);
    }

    // --- Standing (the single view every surface gates on) ---

    function isAgentInGoodStanding(address wallet) public view returns (bool ok, bytes32 reason) {
        if (mandate.agent == address(0) || wallet != mandate.agent) return (false, "NO_MANDATE");
        if (mandate.revoked) return (false, "MANDATE_REVOKED");
        if (mandate.expiresAt != 0 && block.timestamp > mandate.expiresAt) return (false, "MANDATE_EXPIRED");
        for (uint256 i = 0; i < owners.length; i++) {
            if (!ACCESS_GATE.canAccessDealRoom(owners[i])) return (false, "OWNER_NOT_COMPLIANT");
        }
        return (true, bytes32(0));
    }

    function isCompliantOwner(address wallet) public view returns (bool) {
        return isOwner[wallet] && ACCESS_GATE.canAccessDealRoom(wallet);
    }

    function agentPerTxCap() external view returns (uint256) {
        return mandate.perTxCap;
    }

    function mandateAgent() external view returns (address) {
        return mandate.agent;
    }

    function ownersCount() external view returns (uint256) {
        return owners.length;
    }

    // --- Funding ---

    function fundConcierge(uint256 casaAmount) external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        HOUSE_TOKEN.mint(mandate.agent, casaAmount);
        emit ConciergeFunded(mandate.agent, casaAmount);
    }

    function reclaimBudget(uint256 casaAmount) external onlyOwner {
        if (mandate.agent == address(0)) revert NoMandate();
        HOUSE_TOKEN.reclaim(mandate.agent, casaAmount);
    }

    function deposit(uint256 amount) external {
        SPEND_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    // --- Payments (rail 2: above-threshold, owner-approved) ---

    function proposePayment(address vendor, uint256 amount, bytes32 evidenceHash)
        external
        returns (uint256 id)
    {
        (bool ok,) = isAgentInGoodStanding(msg.sender);
        if (!ok) revert NotAgent();
        if (vendor == address(0)) revert ZeroAddress();
        id = nextPaymentId++;
        payments[id] = PendingPayment({
            vendor: vendor,
            amount: amount,
            evidenceHash: evidenceHash,
            approvals: 0,
            executed: false
        });
        emit PaymentProposed(id, vendor, amount, evidenceHash);
    }

    function approvePayment(uint256 id) external onlyOwner {
        PendingPayment storage p = payments[id];
        if (p.vendor == address(0)) revert UnknownPayment();
        if (p.executed) revert AlreadyExecuted();
        if (approvedBy[id][msg.sender]) revert AlreadyApproved();
        approvedBy[id][msg.sender] = true;
        p.approvals++;
        emit PaymentApproved(id, msg.sender, p.approvals);
    }

    function executePayment(uint256 id) external {
        PendingPayment storage p = payments[id];
        if (p.vendor == address(0)) revert UnknownPayment();
        if (p.executed) revert AlreadyExecuted();
        if (p.approvals < APPROVAL_THRESHOLD) revert ThresholdNotMet();
        p.executed = true;
        SPEND_TOKEN.safeTransfer(p.vendor, p.amount);
        emit PaymentExecuted(id, p.vendor, p.amount);
    }
}
