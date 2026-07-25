import { Address } from '@graphprotocol/graph-ts';
import { SubnameIssued } from '../generated/PassportSubnameRegistrar/PassportSubnameRegistrar';
import { TenantSet } from '../generated/PassportResolver/PassportResolver';
import { Subname, Tenant } from '../generated/schema';
import { getOrCreateIdentity } from './helpers';

export function handleSubnameIssued(event: SubnameIssued): void {
  const id = event.params.parentNode.toHexString() + '-' + event.params.label;
  let subname = Subname.load(id);
  if (subname == null) subname = new Subname(id);
  subname.parentNode = event.params.parentNode;
  subname.label = event.params.label;
  subname.wallet = event.params.userWallet;
  if (event.params.identity.notEqual(Address.zero())) {
    subname.identity = getOrCreateIdentity(event.params.identity, event).id;
  }
  subname.issuedAt = event.block.timestamp;
  subname.save();
}

export function handleTenantSet(event: TenantSet): void {
  let tenant = Tenant.load(event.params.parentNode);
  if (tenant == null) tenant = new Tenant(event.params.parentNode);
  tenant.gate = event.params.gate;
  tenant.policyId = event.params.policyId;
  tenant.controller = event.params.controller;
  tenant.updatedAt = event.block.timestamp;
  tenant.save();
}
