/**
 * The concierge's ticket feed.
 *
 * Tickets are the one piece of demo state that is NOT on chain: the decision, its
 * rationale and the evidence hash are produced off-chain and only the hash is
 * anchored. The standalone concierge server kept them in a module-level array;
 * this keeps the same in-memory feed, parked on globalThis so `next dev`'s HMR
 * does not wipe it between edits. A world reset clears it.
 */
import type { Address, Hex } from 'viem';

export interface TicketDecision {
  action: 'pay' | 'propose' | 'reject';
  rationale: string;
  confidence: number;
}

export interface DemoTicket {
  id: number;
  description: string;
  category: string;
  vendor: Address;
  /// mUSD, 2 decimals — the display string the UIs already render
  amount: string;
  decision: TicketDecision;
  evidenceHash: Hex;
  txHashes: Hex[];
  refusal: { reason: string; wallet: Address | null; message: string; source?: string } | null;
  settleError: string | null;
  paid: boolean;
  paymentId: number | null;
  status: string;
  at: number;
}

interface TicketStore {
  tickets: DemoTicket[];
  counter: number;
}

const globalState = globalThis as unknown as { __passportkitTickets?: TicketStore };
const store: TicketStore = (globalState.__passportkitTickets ??= { tickets: [], counter: 0 });

export function nextTicketId(): number {
  return ++store.counter;
}

export function addTicket(ticket: DemoTicket): DemoTicket {
  store.tickets.push(ticket);
  return ticket;
}

/// Newest first — the order the ticket feed renders in.
export function listTickets(): DemoTicket[] {
  return [...store.tickets].reverse();
}

export function findTicketByPaymentId(paymentId: number): DemoTicket | undefined {
  return store.tickets.find((t) => t.paymentId === paymentId);
}

export function clearTickets(): void {
  store.tickets = [];
  store.counter = 0;
}
