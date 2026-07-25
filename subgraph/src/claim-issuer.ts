import { RevocationSet, SignerSet } from '../generated/ClaimIssuer/ClaimIssuer';
import { Claim, ClaimEvent, RevocationLatch, SignerStatus } from '../generated/schema';
import { eventId, getOrCreateIdentity, getOrCreateIssuer, snapshotEligibility, topicName } from './helpers';

export function handleRevocationSet(event: RevocationSet): void {
  const identityAddr = event.params.identity;
  const topic = event.params.topic;
  const revoked = event.params.revoked;
  const issuerAddr = event.address; // the ClaimIssuer holding the latch

  getOrCreateIssuer(issuerAddr);
  const identity = getOrCreateIdentity(identityAddr, event);

  // issuer is part of the id: each ClaimIssuer holds its own latch map, and a
  // second trusted issuer must not collide with the first
  const latchId = identityAddr.toHexString() + '-' + topic.toString() + '-' + issuerAddr.toHexString();
  let latch = RevocationLatch.load(latchId);
  if (latch == null) {
    latch = new RevocationLatch(latchId);
    latch.identity = identity.id;
    latch.issuer = issuerAddr;
    latch.topic = topic;
    latch.topicName = topicName(topic);
  }
  latch.revoked = revoked;
  latch.updatedAt = event.block.timestamp;
  latch.save();

  // mirror the latch on the stored claim (holder-removed claims stay REMOVED)
  const claimId = identityAddr.toHexString() + '-' + topic.toString() + '-' + issuerAddr.toHexString();
  const claim = Claim.load(claimId);
  if (claim != null && claim.status != 'REMOVED') {
    claim.status = revoked ? 'REVOKED' : 'ACTIVE';
    claim.updatedAt = event.block.timestamp;
    claim.save();
  }

  const ev = new ClaimEvent(eventId(event));
  ev.kind = revoked ? 'LATCH_ON' : 'LATCH_OFF';
  ev.identity = identity.id;
  ev.wallet = identity.wallet;
  ev.topic = topic;
  ev.topicName = topicName(topic);
  ev.issuer = issuerAddr;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();

  const state = revoked ? ' ON' : ' OFF';
  snapshotEligibility(identityAddr, 'RevocationSet(' + topicName(topic) + state + ')', event);
}

export function handleSignerSet(event: SignerSet): void {
  const id = event.address.toHexString() + '-' + event.params.signer.toHexString();
  let status = SignerStatus.load(id);
  if (status == null) {
    status = new SignerStatus(id);
    status.issuer = event.address;
    status.signer = event.params.signer;
  }
  status.authorized = event.params.ok;
  status.updatedAt = event.block.timestamp;
  status.save();
}
