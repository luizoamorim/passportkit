/**
 * POST /api/demo/markets — every write the ComplianceHook demo makes.
 *
 * {action:'swap'|'liquidity'|'verify'|'revoke', actor, pool?, claim?, direction?, zeroForOne?, approved?}
 *
 * Ported from apps/hook-demo/server.js (/api/swap, /api/liquidity, /api/verify,
 * /api/revoke-claim, /api/restore-claim, /api/revoke-passport) with the response
 * shapes unchanged. Two of the old routes fold into 'verify': re-verifying an
 * actor re-opens the issuer's latch before re-submitting, which is exactly what
 * restore-claim did, and `revoke` without a `claim` revokes every topic at once
 * (the old revoke-passport).
 *
 * A refused write is NOT an HTTP error: the chain refusing is the demo's hero
 * moment, so it comes back 200 with {ok:false, reason, wallet, message} and the
 * page renders the reason code. Only a broken request is a 4xx.
 *
 * Demo-only: DEMO_MODE must be 'true' or every method here is a 403.
 */
import { encodeAbiParameters, formatEther, type Address, type Hex } from 'viem';

import { LIQUIDITY_ROUTER_ABI, SWAP_ROUTER_ABI } from '@/lib/demo/abis';
import {
  MAX_SQRT_PRICE_MINUS_1,
  MIN_SQRT_PRICE_PLUS_1,
  actorAddress,
  addresses,
  assertDemo,
  balancesOf,
  chainNow,
  deltasBetween,
  demoDisabledResponse,
  demoEnabled,
  failure,
  isActor,
  jsonResponse,
  pools,
  refreshLogs,
  saltOf,
  write,
  type DemoActor,
  type PoolName,
} from '@/lib/demo/chain';
import {
  CLAIM_TOPICS,
  claimState,
  ensureIdentity,
  identityOf,
  isClaimName,
  isRevoked,
  setRevoked,
  submitClaim,
  type ClaimName,
} from '@/lib/demo/identity';
import { aggregateLiquidity } from '@/lib/demo/positions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/// Exact-input swap of 1 token (negative = "spend exactly this much").
const SWAP_AMOUNT = -1_000000000000000000n;
/// One click of liquidity, added or removed.
const LIQUIDITY_STEP = 2_000000000000000000n;
/// Full range for tickSpacing 60 — TickMath.{min,max}UsableTick.
const TICK_LOWER = -887220;
const TICK_UPPER = 887220;

/// The hook reads the trader's wallet out of hookData: the router is msg.sender,
/// so without this every swap would be judged on the ROUTER's compliance.
const hookDataFor = (wallet: Address) => encodeAbiParameters([{ type: 'address' }], [wallet]);

const MARKET_POOLS: PoolName[] = ['deal', 'investor'];
const isMarketPool = (name: unknown): name is PoolName =>
  typeof name === 'string' && (MARKET_POOLS as string[]).includes(name);

// ---------------------------------------------------------------- actions

async function doSwap(actor: DemoActor, poolName: PoolName, zeroForOne: boolean) {
  const pool = pools()[poolName];
  const wallet = actorAddress(actor);
  const before = await balancesOf(wallet);
  const txHash = await write(actor, addresses().swapRouter, SWAP_ROUTER_ABI, 'swap', [
    pool.key,
    {
      zeroForOne,
      amountSpecified: SWAP_AMOUNT,
      sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_1 : MAX_SQRT_PRICE_MINUS_1,
    },
    { takeClaims: false, settleUsingBurn: false },
    hookDataFor(wallet),
  ]);
  return { ok: true, txHash, delta: deltasBetween(before, await balancesOf(wallet)) };
}

/// Free exit: 'remove' passes a negative delta, which the hook does not gate —
/// compliance blocks movement to a counterparty, never your own way out.
async function doLiquidity(actor: DemoActor, poolName: PoolName, direction: 'add' | 'remove') {
  const pool = pools()[poolName];
  const wallet = actorAddress(actor);
  const before = await balancesOf(wallet);
  const txHash = await write(actor, addresses().liquidityRouter, LIQUIDITY_ROUTER_ABI, 'modifyLiquidity', [
    pool.key,
    TICK_LOWER,
    TICK_UPPER,
    direction === 'remove' ? -LIQUIDITY_STEP : LIQUIDITY_STEP,
    hookDataFor(wallet),
  ]);
  const { positions } = aggregateLiquidity(await refreshLogs()) as { positions: Map<string, bigint> };
  return {
    ok: true,
    txHash,
    delta: deltasBetween(before, await balancesOf(wallet)),
    position: formatEther(positions.get(`${pool.id}|${saltOf(wallet)}`) ?? 0n),
  };
}

/// "Verify" = mint the identity if needed, re-open the issuer latch if it was closed,
/// and issue a claim only if the identity does not already hold a valid one.
/// approved=false is the issuer refusing: it closes the latch instead.
///
/// The two halves are deliberately independent, because the demo tells two different
/// stories with them. Re-opening the latch is usually the WHOLE fix — the signed claim
/// never left the Identity, so the wallet clears the policy again in one transaction
/// with nothing re-issued. An EXPIRED claim is the other case: after a timewarp the
/// latch alone restores nothing, and only then does the issuer sign a fresh one. Always
/// re-issuing would erase that distinction and no wallet could ever be seen EXPIRED.
async function doVerify(actor: DemoActor, claim: ClaimName, approved: boolean) {
  const topic = CLAIM_TOPICS[claim];
  const { identity, txHashes } = await ensureIdentity(actor);

  if (!approved) {
    txHashes.push(await setRevoked(identity, topic, true));
    return { ok: true, txHashes };
  }

  // the latch blocks re-submission too — issuer re-approval comes first
  if (await isRevoked(identity, topic)) txHashes.push(await setRevoked(identity, topic, false));

  // per TOPIC, not per policy: 'accredited' must not be skipped just because the
  // wallet already clears the KYC-only policy
  const state = await claimState(identity, topic, await chainNow());
  if (state.status !== 'VERIFIED') txHashes.push(await submitClaim(actor, identity, topic));
  return { ok: true, txHashes };
}

/// THE MONEY MOMENT: one latch flip and every surface refuses this identity. With
/// no `claim`, every topic goes at once — the whole identity goes dark.
async function doRevoke(actor: DemoActor, claim: ClaimName | null) {
  const identity = await identityOf(actorAddress(actor));
  if (!identity) return { ok: false, reason: 'NO_IDENTITY', message: `${actor} has no identity yet` };

  const topics = claim ? [CLAIM_TOPICS[claim]] : Object.values(CLAIM_TOPICS);
  const txHashes: Hex[] = [];
  for (const topic of topics) txHashes.push(await setRevoked(identity, topic, true));
  return { ok: true, txHashes };
}

// ---------------------------------------------------------------- handler

interface MarketsBody {
  action?: string;
  actor?: string;
  pool?: string;
  claim?: string;
  direction?: string;
  zeroForOne?: boolean;
  approved?: boolean;
}

export async function POST(req: Request) {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    const body = (await req.json().catch(() => ({}))) as MarketsBody;
    const { action, actor, pool = 'deal', claim, direction = 'add', zeroForOne = true, approved = true } = body;

    if (!isActor(actor)) return jsonResponse(400, { ok: false, message: 'unknown actor' });

    if (action === 'swap' || action === 'liquidity') {
      if (!isMarketPool(pool)) return jsonResponse(400, { ok: false, message: "unknown pool — expected 'deal' or 'investor'" });
      const run =
        action === 'swap'
          ? doSwap(actor, pool, Boolean(zeroForOne))
          : doLiquidity(actor, pool, direction === 'remove' ? 'remove' : 'add');
      return jsonResponse(200, await run.catch(failure));
    }

    if (action === 'verify') {
      if (!isClaimName(claim)) return jsonResponse(400, { ok: false, message: "unknown claim — expected 'kyc' or 'accredited'" });
      return jsonResponse(200, await doVerify(actor, claim, Boolean(approved)).catch(failure));
    }

    if (action === 'revoke') {
      // no claim at all revokes every topic; a named claim must still be a real one
      if (claim !== undefined && !isClaimName(claim)) {
        return jsonResponse(400, { ok: false, message: "unknown claim — expected 'kyc' or 'accredited'" });
      }
      return jsonResponse(200, await doRevoke(actor, isClaimName(claim) ? claim : null).catch(failure));
    }

    return jsonResponse(400, {
      ok: false,
      message: "unknown action — expected 'swap', 'liquidity', 'verify' or 'revoke'",
    });
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}
