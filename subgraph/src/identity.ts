import { ethereum } from '@graphprotocol/graph-ts';
import { ClaimAdded, ClaimRevoked, Identity as IdentityContract } from '../generated/templates/Identity/Identity';
import { Claim, ClaimEvent } from '../generated/schema';
import { eventId, getOrCreateIdentity, getOrCreateIssuer, snapshotEligibility, topicName } from './helpers';

export function handleClaimAdded(event: ClaimAdded): void {
  const identityAddr = event.address;
  const topic = event.params.topic;
  const issuerAddr = event.params.issuer;

  getOrCreateIssuer(issuerAddr);
  const identity = getOrCreateIdentity(identityAddr, event);

  const claimId = identityAddr.toHexString() + '-' + topic.toString() + '-' + issuerAddr.toHexString();
  let claim = Claim.load(claimId);
  if (claim == null) {
    claim = new Claim(claimId);
    claim.identity = identity.id;
    claim.topic = topic;
    claim.topicName = topicName(topic);
    claim.issuer = issuerAddr;
    claim.addedAt = event.block.timestamp;
  }
  // a claim can only land while the latch is off (submitClaim checks isClaimValid)
  claim.status = 'ACTIVE';
  claim.updatedAt = event.block.timestamp;

  // ClaimAdded carries no payload — read it back and decode
  // data = abi.encode(dataHash, expiresAt, nonce); zero PII, expiry included.
  const contract = IdentityContract.bind(identityAddr);
  const stored = contract.try_getClaim(topic, issuerAddr);
  if (!stored.reverted && stored.value.value0) {
    const decoded = ethereum.decode('(bytes32,uint64,bytes32)', stored.value.value2);
    if (decoded != null) {
      const tuple = decoded.toTuple();
      claim.dataHash = tuple[0].toBytes();
      claim.expiresAt = tuple[1].toBigInt();
    }
  }
  claim.save();

  const ev = new ClaimEvent(eventId(event));
  ev.kind = 'ADDED';
  ev.identity = identity.id;
  ev.wallet = identity.wallet;
  ev.topic = topic;
  ev.topicName = topicName(topic);
  ev.issuer = issuerAddr;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();

  snapshotEligibility(identityAddr, 'ClaimAdded(' + topicName(topic) + ')', event);
}

export function handleClaimRevoked(event: ClaimRevoked): void {
  const identityAddr = event.address;
  const topic = event.params.topic;
  const issuerAddr = event.params.issuer;
  const identity = getOrCreateIdentity(identityAddr, event);

  const claimId = identityAddr.toHexString() + '-' + topic.toString() + '-' + issuerAddr.toHexString();
  const claim = Claim.load(claimId);
  if (claim != null) {
    claim.status = 'REMOVED';
    claim.updatedAt = event.block.timestamp;
    claim.save();
  }

  const ev = new ClaimEvent(eventId(event));
  ev.kind = 'REMOVED';
  ev.identity = identity.id;
  ev.wallet = identity.wallet;
  ev.topic = topic;
  ev.topicName = topicName(topic);
  ev.issuer = issuerAddr;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();

  snapshotEligibility(identityAddr, 'ClaimRemoved(' + topicName(topic) + ')', event);
}
