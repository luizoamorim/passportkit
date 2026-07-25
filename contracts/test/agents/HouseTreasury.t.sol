// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {ClaimRegistry} from "../../src/ClaimRegistry.sol";
import {CompliancePassport} from "../../src/CompliancePassport.sol";
import {AccessGate} from "../../src/AccessGate.sol";
import {IAccessGate} from "../../src/interfaces/IAccessGate.sol";
import {HouseTreasury} from "../../src/agents/HouseTreasury.sol";

contract HouseTreasuryTest is Test {
    ClaimRegistry registry;
    CompliancePassport passport;
    AccessGate gate;
    MockERC20 musd;
    HouseTreasury treasury;

    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address ownerA = makeAddr("ownerA");
    address ownerB = makeAddr("ownerB");
    address concierge = makeAddr("concierge");
    address stranger = makeAddr("stranger");

    bytes32 constant KYC = keccak256("KYC_AML_VERIFIED");
    uint64 FUTURE;
    uint256 nonce;

    function setUp() public {
        FUTURE = uint64(block.timestamp + 365 days);
        registry = new ClaimRegistry(admin);
        passport = new CompliancePassport(admin, address(registry));
        gate = new AccessGate(address(registry), address(passport));
        vm.startPrank(admin);
        registry.grantRole(registry.CRE_UPDATER_ROLE(), updater);
        passport.grantRole(passport.CRE_UPDATER_ROLE(), updater);
        vm.stopPrank();

        _verifyKyc(ownerA);
        _verifyKyc(ownerB);

        musd = new MockERC20("Mock USD", "mUSD", 18);
        address[] memory owners = new address[](2);
        owners[0] = ownerA;
        owners[1] = ownerB;
        treasury = new HouseTreasury(owners, 2, IERC20(address(musd)), IAccessGate(address(gate)), "Casa Azul Scrip", "CASA");
    }

    // --- helpers ---

    function _verifyKyc(address user) internal {
        vm.startPrank(updater);
        registry.submitClaim(user, KYC, true, keccak256(abi.encode(nonce++)), keccak256("attest"), FUTURE);
        passport.syncPassport(user);
        vm.stopPrank();
    }

    function _grant() internal {
        vm.prank(ownerA);
        treasury.grantMandate(concierge, 200 ether, FUTURE);
    }

    // --- mandate + standing ---

    function test_standing_no_mandate() public view {
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_MANDATE"));
    }

    function test_standing_ok_after_grant() public {
        _grant();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertTrue(ok);
        assertEq(reason, bytes32(0));
    }

    function test_standing_wrong_wallet_is_no_mandate() public {
        _grant();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(stranger);
        assertFalse(ok);
        assertEq(reason, bytes32("NO_MANDATE"));
    }

    function test_standing_revoked() public {
        _grant();
        vm.prank(ownerB);
        treasury.revokeMandate();
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("MANDATE_REVOKED"));
    }

    function test_standing_expired() public {
        _grant();
        vm.warp(uint256(FUTURE) + 1);
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("MANDATE_EXPIRED"));
    }

    function test_standing_dies_with_owner_compliance() public {
        _grant();
        vm.prank(admin);
        passport.revokePassport(ownerB); // one owner loses compliance
        (bool ok, bytes32 reason) = treasury.isAgentInGoodStanding(concierge);
        assertFalse(ok);
        assertEq(reason, bytes32("OWNER_NOT_COMPLIANT"));
    }

    function test_only_owner_grants_and_revokes() public {
        vm.prank(stranger);
        vm.expectRevert(HouseTreasury.NotOwner.selector);
        treasury.grantMandate(concierge, 1 ether, FUTURE);
        _grant();
        vm.prank(stranger);
        vm.expectRevert(HouseTreasury.NotOwner.selector);
        treasury.revokeMandate();
    }

    // --- funding ---

    function test_fund_concierge_mints_casa() public {
        _grant();
        vm.prank(ownerA);
        treasury.fundConcierge(50 ether);
        assertEq(treasury.HOUSE_TOKEN().balanceOf(concierge), 50 ether);
    }

    function test_reclaim_budget_burns_casa() public {
        _grant();
        vm.startPrank(ownerA);
        treasury.fundConcierge(50 ether);
        treasury.reclaimBudget(20 ether);
        vm.stopPrank();
        assertEq(treasury.HOUSE_TOKEN().balanceOf(concierge), 30 ether);
    }

    function test_fund_requires_mandate() public {
        vm.prank(ownerA);
        vm.expectRevert(HouseTreasury.NoMandate.selector);
        treasury.fundConcierge(1 ether);
    }

    function test_deposit_pulls_spend_token() public {
        musd.mint(ownerA, 100 ether);
        vm.startPrank(ownerA);
        musd.approve(address(treasury), 100 ether);
        treasury.deposit(100 ether);
        vm.stopPrank();
        assertEq(musd.balanceOf(address(treasury)), 100 ether);
    }

    function test_is_compliant_owner() public {
        assertTrue(treasury.isCompliantOwner(ownerA));
        assertFalse(treasury.isCompliantOwner(stranger));
        vm.prank(admin);
        passport.revokePassport(ownerA);
        assertFalse(treasury.isCompliantOwner(ownerA));
    }
}
