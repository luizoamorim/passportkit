import { Address } from '@graphprotocol/graph-ts';
import { Transfer } from '../generated/GatedERC20/GatedERC20';
import { TokenTransfer } from '../generated/schema';
import { eventId } from './helpers';

export function handleTransfer(event: Transfer): void {
  const t = new TokenTransfer(eventId(event));
  t.token = event.address;
  t.from = event.params.from;
  t.to = event.params.to;
  t.value = event.params.value;
  t.isMint = event.params.from.equals(Address.zero());
  t.isBurn = event.params.to.equals(Address.zero());
  t.txHash = event.transaction.hash;
  t.block = event.block.number;
  t.timestamp = event.block.timestamp;
  t.save();
}
