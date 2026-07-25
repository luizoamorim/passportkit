/**
 * POST /api/demo/vendor/invoice — the mock plumber, speaking x402.
 *
 * The counterparty in the concierge demo, and deliberately UNTRUSTED: it names the
 * recipient and the sum in its own 402 body, and the agent's client
 * (src/lib/demo/x402.js) checks every field against what it already knows before a
 * single wei moves. Keeping it in-process is what makes the whole rail runnable
 * offline — the same role apps/concierge/vendor/server.js played on port 4191.
 *
 *   POST without X-PAYMENT            → 402 {x402Version, accepts:[{scheme:'exact', …}]}
 *   POST with X-PAYMENT {"txHash"}    → 200 {paid:true, jobId} once the tx checks out
 *   POST with a payment that does not → 402, the same challenge again
 *
 * Verification is done here, against the chain: a successful receipt carrying an
 * ERC-20 Transfer of at least `amount` mUSD to the plumber's wallet. A vendor that
 * took the client's word for it would not be demonstrating anything.
 *
 * Demo-only: DEMO_MODE must be 'true' or every method here is a 403.
 */
import { getAddress, pad, toEventSelector, type Hex } from 'viem';

import {
  actorAddress,
  addresses,
  assertDemo,
  demoDisabledResponse,
  demoEnabled,
  failure,
  jsonResponse,
  publicClient,
} from '@/lib/demo/chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TRANSFER_TOPIC = toEventSelector('Transfer(address,address,uint256)');
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/// The 402 body: one 'exact' offer, paying `amount` of mUSD to the plumber.
function challenge(amount: unknown) {
  return jsonResponse(402, {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155-local',
        asset: addresses().musd,
        amount,
        payTo: actorAddress('plumber'),
      },
    ],
  });
}

/// Did `txHash` really pay us? A mined, successful tx with an ERC-20 Transfer log
/// on the mUSD contract crediting the plumber at least `amount`.
async function verifyPayment(txHash: unknown, amount: unknown): Promise<boolean> {
  if (typeof txHash !== 'string' || !TX_HASH.test(txHash)) return false;
  try {
    const want = BigInt(String(amount));
    const asset = getAddress(addresses().musd).toLowerCase();
    const paddedPayTo = pad(actorAddress('plumber'), { size: 32 }).toLowerCase();

    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as Hex });
    if (receipt.status !== 'success') return false;

    return receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== asset) return false;
      if (log.topics[0] !== TRANSFER_TOPIC) return false;
      if (log.topics[2]?.toLowerCase() !== paddedPayTo) return false;
      return BigInt(log.data) >= want;
    });
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    const { jobId, amount } = (await req.json().catch(() => ({}))) as { jobId?: unknown; amount?: unknown };

    const header = req.headers.get('x-payment');
    if (!header) return challenge(amount);

    let txHash: unknown;
    try {
      ({ txHash } = JSON.parse(header));
    } catch {
      return challenge(amount);
    }

    if (!(await verifyPayment(txHash, amount))) return challenge(amount);
    return jsonResponse(200, { paid: true, jobId });
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}
