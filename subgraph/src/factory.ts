import { AgentLinked, AgentUnlinked, IdentityCreated } from '../generated/IdentityFactory/IdentityFactory';
import { Identity as IdentityTemplate } from '../generated/templates';
import { AgentEvent, AgentLink, Identity, Wallet } from '../generated/schema';
import { eventId, snapshotEligibility } from './helpers';

export function handleIdentityCreated(event: IdentityCreated): void {
  let identity = Identity.load(event.params.identity);
  if (identity == null) identity = new Identity(event.params.identity);
  identity.wallet = event.params.wallet;
  identity.createdAt = event.block.timestamp;
  identity.createdAtBlock = event.block.number;
  identity.createdTx = event.transaction.hash;
  identity.save();

  let wallet = Wallet.load(event.params.wallet);
  if (wallet == null) wallet = new Wallet(event.params.wallet);
  wallet.identity = identity.id;
  wallet.isAgent = false;
  wallet.save();

  // start indexing this user's Identity contract (ClaimAdded / ClaimRevoked)
  IdentityTemplate.create(event.params.identity);

  snapshotEligibility(event.params.identity, 'IdentityCreated', event);
}

export function handleAgentLinked(event: AgentLinked): void {
  let link = AgentLink.load(event.params.agentWallet);
  if (link == null) link = new AgentLink(event.params.agentWallet);
  link.agentWallet = event.params.agentWallet;
  link.personIdentity = event.params.personIdentity; // factory guards isIdentity
  link.active = true;
  link.linkedAt = event.block.timestamp;
  link.unlinkedAt = null;
  link.save();

  let wallet = Wallet.load(event.params.agentWallet);
  if (wallet == null) wallet = new Wallet(event.params.agentWallet);
  wallet.identity = event.params.personIdentity;
  wallet.isAgent = true;
  wallet.save();

  const ev = new AgentEvent(eventId(event));
  ev.kind = 'LINKED';
  ev.agentWallet = event.params.agentWallet;
  ev.personIdentity = event.params.personIdentity;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();
}

export function handleAgentUnlinked(event: AgentUnlinked): void {
  const link = AgentLink.load(event.params.agentWallet);
  if (link != null) {
    link.active = false;
    link.unlinkedAt = event.block.timestamp;
    link.save();
  }

  const wallet = Wallet.load(event.params.agentWallet);
  if (wallet != null) {
    wallet.identity = null;
    wallet.isAgent = false;
    wallet.save();
  }

  const ev = new AgentEvent(eventId(event));
  ev.kind = 'UNLINKED';
  ev.agentWallet = event.params.agentWallet;
  ev.personIdentity = event.params.personIdentity;
  ev.txHash = event.transaction.hash;
  ev.block = event.block.number;
  ev.timestamp = event.block.timestamp;
  ev.save();
}
