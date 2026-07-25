/**
 * POST /api/demo/concierge — every write the House Concierge demo makes.
 *
 * {action:'ticket'|'approve'|'fund'|'grant-mandate'|'revoke-mandate'
 *         |'revoke-owner-kyc'|'restore-owner-kyc', ...}
 *
 * Ported from apps/concierge/server.js with the ticket record shape unchanged.
 * The agent has TWO rails and they fail differently:
 *   rail 1 (autonomous) — sell CASA for the invoice through the MandateHook pool,
 *                         then settle the vendor's x402 invoice in mUSD;
 *   rail 2 (governed)   — propose the payment to the treasury for owner approval.
 * Both rails root in the OWNERS' compliance: revoke an owner's KYC and the very
 * next call on either rail is refused.
 *
 * A refused write comes back 200 with the refusal on the record — the chain saying
 * no IS the demo. Only a broken request is a 4xx.
 *
 * Demo-only: DEMO_MODE must be 'true' or every method here is a 403.
 */
import { encodeAbiParameters, formatEther, parseEther, type Address, type Hex } from 'viem';

import { ERC20_ABI, SWAP_ROUTER_ABI, TREASURY_ABI } from '@/lib/demo/abis';
import {
  MAX_SQRT_PRICE_MINUS_1,
  MIN_SQRT_PRICE_PLUS_1,
  OWNERS,
  actorAddress,
  addresses,
  assertDemo,
  bytes32ToString,
  casaIsCurrency0,
  chainNow,
  demoDisabledResponse,
  demoEnabled,
  failure,
  isActor,
  jsonResponse,
  pools,
  publicClient,
  readBalance,
  send,
  write,
  type DemoActor,
} from '@/lib/demo/chain';
import { decodeRefusal } from '@/lib/demo/decode.js';
import { makeDecider } from '@/lib/demo/deciders.js';
import { evidenceHash } from '@/lib/demo/evidence.js';
import { CLAIM_TOPICS, ensureIdentity, identityOf, isCompliant, setRevoked, submitClaim } from '@/lib/demo/identity';
import { addTicket, findTicketByPaymentId, nextTicketId, type DemoTicket, type TicketDecision } from '@/lib/demo/tickets';
import { settleInvoice } from '@/lib/demo/x402.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/// What `grant-mandate` re-grants: the same terms DeployAll.s.sol set up.
const MANDATE_CAP = parseEther('200');
const MANDATE_DURATION = 365 * 24 * 3600;

/// decision engine: mock rules by default, OpenAI-compatible or 0G when configured
const decide = makeDecider(process.env.DECIDER ?? 'mock', {
  baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
}) as unknown as (ticket: unknown, context: unknown) => Promise<TicketDecision>;

const isOwner = (name: unknown): name is DemoActor => isActor(name) && OWNERS.includes(name);

// ---------------------------------------------------------------- treasury reads

async function readTreasury<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
  const value = await publicClient.readContract({
    address: addresses().treasury,
    abi: TREASURY_ABI,
    functionName,
    args,
  } as never);
  return value as T;
}

async function readStanding(wallet: Address) {
  const [ok, reason] = await readTreasury<[boolean, Hex]>('isAgentInGoodStanding', [wallet]);
  return { ok, reason: bytes32ToString(reason) || null };
}

async function readPayment(id: number) {
  const [vendor, amount, evidence, approvals, executed] = await readTreasury<[Address, bigint, Hex, bigint, boolean]>(
    'payments',
    [BigInt(id)],
  );
  return { id, vendor, amount, evidenceHash: evidence, approvals, executed };
}

// ---------------------------------------------------------------- refusals

/// The ticket record's `refusal` — the same fields as chain.ts's failure(), minus
/// the `ok` flag the record does not carry.
function refusalOf(err: unknown): NonNullable<DemoTicket['refusal']> {
  const { reason, wallet, message } = failure(err);
  return { reason, wallet, message };
}

/// Rail 2 reverts bare — HouseTreasury.NotAgent() carries no reason code, so
/// decodeRefusal finds nothing. Fall back to the treasury's own standing view so
/// the refusal still names *why* the agent lost authority.
async function refusalWithStanding(err: unknown): Promise<NonNullable<DemoTicket['refusal']>> {
  const refusal = refusalOf(err);
  if (decodeRefusal(err)) return refusal;
  const standing = await readStanding(actorAddress('concierge')).catch(() => null);
  if (!standing || standing.ok || !standing.reason) return refusal;
  return { ...refusal, reason: standing.reason, wallet: actorAddress('concierge'), source: 'treasury' };
}

// ---------------------------------------------------------------- rail 1

/// Rail 1, step 1: liquify budget. The concierge sells CASA for exactly the
/// invoice amount of mUSD through the MandateHook-gated pool — an exact-OUTPUT
/// swap, because an exact-input swap of `amount` CASA nets less than `amount`
/// mUSD (0.3% pool fee) and could not settle the invoice. The hook still sees
/// |amountSpecified| == the ticket amount for its per-tx cap check.
function swapForInvoice(amountWei: bigint): Promise<Hex> {
  const casaFirst = casaIsCurrency0();
  return write('concierge', addresses().swapRouter, SWAP_ROUTER_ABI, 'swap', [
    pools().house.key,
    {
      zeroForOne: casaFirst,
      amountSpecified: amountWei,
      sqrtPriceLimitX96: casaFirst ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
    },
    { takeClaims: false, settleUsingBurn: false },
    encodeAbiParameters([{ type: 'address' }], [actorAddress('concierge')]),
  ]);
}

/// Rail 1, step 2: settle the vendor's x402 invoice from the agent wallet. The
/// vendor names the recipient and the sum in its own 402 body, so `expected` hands
/// the client the two facts we know without asking it — the mUSD address and the
/// plumber's payout wallet — and the invoice amount is checked against the ticket.
/// A vendor that offers anything else gets nothing.
async function payInvoice(id: number, amountWei: bigint, vendorUrl: string) {
  const settled = await settleInvoice({
    vendorUrl,
    jobId: id,
    amount: amountWei.toString(),
    expected: { asset: addresses().musd, payTo: actorAddress('plumber') },
    payFn: (accept: { payTo: Address; amount: string }) =>
      write('concierge', addresses().musd, ERC20_ABI, 'transfer', [accept.payTo, BigInt(accept.amount)]),
  });
  return settled as { paid: boolean; txHash: Hex | null; error?: string };
}

// ---------------------------------------------------------------- actions

interface TicketInput {
  description: string;
  amount: string;
  category: string;
  vendorUrl: string;
}

async function doTicket({ description, amount, category, vendorUrl }: TicketInput) {
  const amountWei = parseEther(String(amount));
  const id = nextTicketId();
  const vendor = actorAddress('plumber');

  const ticket = { id, description, vendor, amount: amountWei, category };
  // Rail 1 sells CASA for *exactly* the invoice in mUSD, so it spends a little
  // more CASA than the invoice (0.3% pool fee + price impact). Hand the decider a
  // 2% haircut on the raw balance, or a ticket sitting just under the budget
  // decides 'pay' and then reverts on the swap with ERC20InsufficientBalance.
  const casaBalance = await readBalance(addresses().casa, actorAddress('concierge'));
  const context = {
    perTxCap: await readTreasury<bigint>('agentPerTxCap'),
    casaBudget: (casaBalance * 98n) / 100n,
  };
  const decision = await decide(ticket, context);
  // The evidence must commit to the *request*, not just the verdict: a hash of the
  // decision alone could be replayed against a different ticket.
  const hash = evidenceHash({ ...decision, ticket: { ...ticket, amount: amountWei.toString() } }) as Hex;

  const record = addTicket({
    id,
    description,
    category,
    vendor,
    amount: Number(formatEther(amountWei)).toFixed(2),
    decision,
    evidenceHash: hash,
    txHashes: [],
    refusal: null,
    settleError: null,
    paid: false,
    paymentId: null,
    status: decision.action,
    at: Date.now(),
  });

  // Rail 1's two legs fail differently, so they do not share a catch: once the swap
  // lands the agent already holds the mUSD, and a settlement failure after that is
  // 'unsettled' (money moved, vendor unpaid) — not 'refused', which means the chain
  // stopped the agent before it spent anything.
  if (decision.action === 'pay') {
    try {
      record.txHashes.push(await swapForInvoice(amountWei));
    } catch (err) {
      record.refusal = await refusalWithStanding(err);
      record.status = 'refused';
      return { ok: true, ticket: record };
    }

    try {
      const settled = await payInvoice(id, amountWei, vendorUrl);
      if (settled.txHash) record.txHashes.push(settled.txHash);
      record.paid = settled.paid;
      if (!settled.paid) record.settleError = settled.error ?? 'vendor did not confirm the payment';
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      record.settleError = String(e?.shortMessage ?? e?.message ?? err).slice(0, 300);
    }
    record.status = record.paid ? 'paid' : 'unsettled';
    return record.paid ? { ok: true, ticket: record } : { ok: false, status: 'unsettled', ticket: record };
  }

  try {
    if (decision.action === 'propose') {
      const { hash: txHash, result } = await send('concierge', addresses().treasury, TREASURY_ABI, 'proposePayment', [
        vendor,
        amountWei,
        hash,
      ]);
      record.txHashes.push(txHash);
      record.paymentId = Number(result);
      record.status = 'pending-approval';
    } else {
      record.status = 'rejected';
    }
  } catch (err) {
    record.refusal = await refusalWithStanding(err);
    record.status = 'refused';
  }

  return { ok: true, ticket: record };
}

/// One owner signs off. The last signature also executes — the demo never leaves a
/// fully-approved payment sitting there waiting for a second button.
async function doApprove(owner: DemoActor, id: number) {
  const txHashes = [await write(owner, addresses().treasury, TREASURY_ABI, 'approvePayment', [BigInt(id)])];
  const [payment, threshold] = await Promise.all([readPayment(id), readTreasury<bigint>('APPROVAL_THRESHOLD')]);

  let executed = payment.executed;
  if (!executed && payment.approvals >= threshold) {
    txHashes.push(await write('operator', addresses().treasury, TREASURY_ABI, 'executePayment', [BigInt(id)]));
    executed = true;
  }

  const ticket = findTicketByPaymentId(id);
  if (ticket) {
    ticket.txHashes.push(...txHashes);
    ticket.status = executed ? 'executed' : 'pending-approval';
    ticket.paid = executed;
  }
  return { ok: true, id, approvals: Number(payment.approvals), executed, txHashes };
}

async function doFund(amount: string) {
  const txHash = await write('operator', addresses().treasury, TREASURY_ABI, 'fundConcierge', [
    parseEther(String(amount)),
  ]);
  return { ok: true, txHashes: [txHash] };
}

async function doGrantMandate() {
  const expiresAt = BigInt((await chainNow()) + MANDATE_DURATION);
  const txHash = await write('operator', addresses().treasury, TREASURY_ABI, 'grantMandate', [
    actorAddress('concierge'),
    MANDATE_CAP,
    expiresAt,
  ]);
  return { ok: true, txHashes: [txHash] };
}

async function doRevokeMandate() {
  return { ok: true, txHashes: [await write('operator', addresses().treasury, TREASURY_ABI, 'revokeMandate', [])] };
}

/// THE MONEY MOMENT: owner compliance is the agent's root of authority. One latch
/// flip on the ClaimIssuer and the treasury — hence BOTH rails — refuses the
/// concierge on the very next call.
async function doRevokeOwnerKyc(owner: DemoActor) {
  const identity = await identityOf(actorAddress(owner));
  if (!identity) return { ok: false, reason: 'NO_IDENTITY', message: `${owner} has no identity yet` };
  return { ok: true, txHashes: [await setRevoked(identity, CLAIM_TOPICS.kyc, true)] };
}

/// Issuer re-approval: re-open the latch. The claim is still stored on the owner's
/// Identity, so they clear the policy again immediately — unless it expired
/// meanwhile (timewarp), in which case the issuer signs a fresh one and the holder
/// submits it (Model B).
async function doRestoreOwnerKyc(owner: DemoActor) {
  const wallet = actorAddress(owner);
  const { identity, txHashes } = await ensureIdentity(owner);

  txHashes.push(await setRevoked(identity, CLAIM_TOPICS.kyc, false));
  if (!(await isCompliant(wallet))) txHashes.push(await submitClaim(owner, identity, CLAIM_TOPICS.kyc));
  return { ok: true, txHashes };
}

// ---------------------------------------------------------------- handler

interface ConciergeBody {
  action?: string;
  description?: string;
  amount?: string | number;
  category?: string;
  owner?: string;
  id?: string | number;
}

/// The mock plumber runs in this very app (/api/demo/vendor). settleInvoice appends
/// '/invoice', so it wants the directory. Same origin as the request unless the
/// operator points DEMO_VENDOR_URL at a real x402 vendor.
function vendorUrlFor(req: Request): string {
  const configured = process.env.DEMO_VENDOR_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${new URL(req.url).origin}/api/demo/vendor`;
}

export async function POST(req: Request) {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    const body = (await req.json().catch(() => ({}))) as ConciergeBody;
    const { action, owner, id } = body;

    switch (action) {
      case 'ticket': {
        const amount = String(body.amount ?? '0');
        if (!/^\d+(\.\d+)?$/.test(amount)) return jsonResponse(400, { ok: false, message: 'bad amount' });
        const ticket = {
          description: body.description ?? 'house ticket',
          amount,
          category: body.category ?? 'plumbing',
          vendorUrl: vendorUrlFor(req),
        };
        return jsonResponse(200, await doTicket(ticket).catch(failure));
      }
      case 'approve': {
        if (!isOwner(owner)) return jsonResponse(400, { ok: false, message: 'unknown owner' });
        if (!Number.isInteger(Number(id)) || Number(id) < 1) {
          return jsonResponse(400, { ok: false, message: 'bad payment id' });
        }
        return jsonResponse(200, await doApprove(owner, Number(id)).catch(failure));
      }
      case 'fund':
        return jsonResponse(200, await doFund(String(body.amount ?? '500')).catch(failure));
      case 'grant-mandate':
        return jsonResponse(200, await doGrantMandate().catch(failure));
      case 'revoke-mandate':
        return jsonResponse(200, await doRevokeMandate().catch(failure));
      case 'revoke-owner-kyc':
        if (!isOwner(owner)) return jsonResponse(400, { ok: false, message: 'unknown owner' });
        return jsonResponse(200, await doRevokeOwnerKyc(owner).catch(failure));
      case 'restore-owner-kyc':
        if (!isOwner(owner)) return jsonResponse(400, { ok: false, message: 'unknown owner' });
        return jsonResponse(200, await doRestoreOwnerKyc(owner).catch(failure));
      default:
        return jsonResponse(400, {
          ok: false,
          message:
            "unknown action — expected 'ticket', 'approve', 'fund', 'grant-mandate', 'revoke-mandate', " +
            "'revoke-owner-kyc' or 'restore-owner-kyc'",
        });
    }
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}
