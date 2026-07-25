import { Address, BigInt, Bytes, ethereum } from '@graphprotocol/graph-ts';
import { EligibilityGate } from '../generated/EligibilityGate/EligibilityGate';
import {
  EligibilitySnapshot,
  Identity,
  Issuer,
  PassportPolicyStatus,
  Protocol,
} from '../generated/schema';

// uint256(keccak256(name)) in decimal — same numbers as contracts/src/libraries/Types.sol
const TOPIC_KYC = '115060095847048098044821322973818454820402841703488225926853443483099350806907';
const TOPIC_PERSONHOOD = '80778018247895315937199618779583894758149695686784755185250718077611651366049';
const TOPIC_ACCREDITED = '89687005231118557273920283710775064796599358059245292461676793952791500988699';

export function topicName(topic: BigInt): string {
  const t = topic.toString();
  if (t == TOPIC_KYC) return 'KYC_VERIFIED';
  if (t == TOPIC_PERSONHOOD) return 'PROOF_OF_PERSONHOOD';
  if (t == TOPIC_ACCREDITED) return 'ACCREDITED_INVESTOR';
  return 'UNKNOWN_' + t;
}

// Reason codes are ASCII bytes32 ("MISSING_KYC\0\0…") — trim the zero padding.
export function bytes32ToString(b: Bytes): string {
  let end = b.length;
  while (end > 0 && b[end - 1] == 0) end--;
  if (end == 0) return '';
  return Bytes.fromUint8Array(b.subarray(0, end)).toString();
}

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

// Shell identities keep relations valid if an event arrives for an identity the
// factory handler has not seen (defensive — should not happen on our deploys).
export function getOrCreateIdentity(addr: Address, event: ethereum.Event): Identity {
  let identity = Identity.load(addr);
  if (identity == null) {
    identity = new Identity(addr);
    identity.wallet = Address.zero();
    identity.createdAt = event.block.timestamp;
    identity.createdAtBlock = event.block.number;
    identity.createdTx = event.transaction.hash;
    identity.save();
  }
  return identity;
}

export function getOrCreateIssuer(addr: Address): Issuer {
  let issuer = Issuer.load(addr);
  if (issuer == null) {
    issuer = new Issuer(addr);
    issuer.save();
  }
  return issuer;
}

// Re-run the gate for every known policy and record the outcome — the subgraph
// keeps the HISTORY of isEligible answers, which no contract stores.
export function snapshotEligibility(identityAddr: Address, trigger: string, event: ethereum.Event): void {
  const protocol = Protocol.load('protocol');
  if (protocol == null) return; // no PolicySet indexed yet
  const gate = EligibilityGate.bind(Address.fromBytes(protocol.gate));
  const identity = getOrCreateIdentity(identityAddr, event);
  const policyIds = protocol.policyIds;
  for (let i = 0; i < policyIds.length; i++) {
    const policyId = policyIds[i];
    const call = gate.try_isEligible(identityAddr, policyId);
    if (call.reverted) continue;
    const eligible = call.value.value0;
    const reason = eligible ? 'OK' : bytes32ToString(call.value.value1);

    const statusId = identityAddr.toHexString() + '-' + policyId.toString();
    let status = PassportPolicyStatus.load(statusId);
    if (status == null) {
      status = new PassportPolicyStatus(statusId);
      status.identity = identity.id;
      status.policy = policyId.toString();
    }
    status.eligible = eligible;
    status.reason = reason;
    status.updatedAt = event.block.timestamp;
    status.save();

    const snap = new EligibilitySnapshot(eventId(event).concatI32(i));
    snap.identity = identity.id;
    snap.wallet = identity.wallet;
    snap.policy = policyId.toString();
    snap.eligible = eligible;
    snap.reason = reason;
    snap.trigger = trigger;
    snap.txHash = event.transaction.hash;
    snap.block = event.block.number;
    snap.timestamp = event.block.timestamp;
    snap.save();
  }
}
