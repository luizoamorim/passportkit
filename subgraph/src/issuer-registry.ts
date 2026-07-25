import { TrustedSet } from '../generated/IssuerRegistry/IssuerRegistry';
import { IssuerTrust } from '../generated/schema';
import { getOrCreateIssuer, topicName } from './helpers';

export function handleTrustedSet(event: TrustedSet): void {
  const issuer = getOrCreateIssuer(event.params.issuer);

  const id = event.params.issuer.toHexString() + '-' + event.params.topic.toString();
  let trust = IssuerTrust.load(id);
  if (trust == null) {
    trust = new IssuerTrust(id);
    trust.issuer = issuer.id;
    trust.topic = event.params.topic;
    trust.topicName = topicName(event.params.topic);
  }
  trust.trusted = event.params.ok;
  trust.updatedAt = event.block.timestamp;
  trust.save();
}
