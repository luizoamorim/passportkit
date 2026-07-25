import { Address } from '@graphprotocol/graph-ts';
import { TrustedSet } from '../generated/IssuerRegistry/IssuerRegistry';
import { Claim, IssuerTrust } from '../generated/schema';
import { getOrCreateIssuer, snapshotEligibility, topicName } from './helpers';

export function handleTrustedSet(event: TrustedSet): void {
  const issuer = getOrCreateIssuer(event.params.issuer);

  const id = event.params.issuer.toHexString() + '-' + event.params.topic.toString();
  let trust = IssuerTrust.load(id);
  if (trust == null) {
    trust = new IssuerTrust(id);
    trust.issuer = issuer.id;
    trust.topic = event.params.topic;
    trust.topicName = topicName(event.params.topic);
    trust.claimIds = [];
  }
  trust.trusted = event.params.ok;
  trust.updatedAt = event.block.timestamp;
  trust.save();

  // De/re-trusting an issuer flips EligibilityGate.isEligible IMMEDIATELY for
  // every identity holding one of its claims — re-snapshot them all now, or
  // PassportPolicyStatus and the audit trail go stale until an unrelated event.
  const state = event.params.ok ? ' ON' : ' OFF';
  const trigger = 'TrustedSet(' + topicName(event.params.topic) + state + ')';
  const seen = new Map<string, boolean>();
  const claimIds = trust.claimIds;
  for (let i = 0; i < claimIds.length; i++) {
    const claim = Claim.load(claimIds[i]);
    if (claim == null) continue;
    const identityId = claim.identity.toHexString();
    if (seen.has(identityId)) continue;
    seen.set(identityId, true);
    snapshotEligibility(Address.fromBytes(claim.identity), trigger, event);
  }
}
