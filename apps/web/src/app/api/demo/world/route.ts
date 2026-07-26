/**
 * GET  /api/demo/world  — the whole demo world in one read.
 * POST /api/demo/world  — { action: 'reset' | 'timewarp', days? }, local anvil only.
 *
 * The state assembly is the union of the two standalone demos' `GET /api/state`:
 * apps/hook-demo (actors, claims, access, positions, the two ComplianceHook pools)
 * and apps/concierge (house, agent standing, owners, tickets, payments). Where the
 * two computed the same thing differently, BOTH shapes are kept under their own
 * keys — `pools.house` is the hook demo's pool row, `house` is the concierge's.
 *
 * Demo-only: DEMO_MODE must be 'true' or every method here is a 403.
 */
import { formatEther, type Address } from 'viem';

import { GATE_ABI, HOOK_ABI, TREASURY_ABI } from '@/lib/demo/abis';
import {
  EXPLORER_URL,
  OWNERS,
  ZERO_ADDRESS,
  addresses,
  assertDemo,
  balancesOf,
  bytes32ToString,
  chainNow,
  demoDisabledResponse,
  demoEnabled,
  failure,
  fixed,
  isLocal,
  isWarped,
  jsonResponse,
  pools,
  publicClient,
  readBalance,
  refreshLogs,
  resetWorld,
  saltOf,
  timewarp,
  actorAddress,
  type DemoActor,
} from '@/lib/demo/chain';
import { ensNameForWallet, ensWorld, type DemoEns } from '@/lib/demo/ens';
import { CLAIM_TOPICS, claimState, identityOf, isCompliant } from '@/lib/demo/identity';
import { aggregateLiquidity, lastPrices } from '@/lib/demo/positions.js';
import { listTickets } from '@/lib/demo/tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/// The three actors that hold an Identity. The concierge and the plumber are plain
/// wallets by design — the agent's authority is the owners', never its own — and
/// they surface under `agent` / `wallets` instead.
const IDENTITY_ACTORS: DemoActor[] = ['operator', 'ana', 'rui'];

// ---------------------------------------------------------------- reads

/// One actor row: their ENS name, identity, both claims, both pool verdicts with
/// their reason codes, LP positions and balances — the hook demo's `actorState`
/// plus the name, so a page never has to know which label belongs to which actor.
async function actorState(name: DemoActor, now: number, positions: Map<string, bigint>, ens: DemoEns) {
  const A = addresses();
  const P = pools();
  const wallet = actorAddress(name);
  const identity = await identityOf(wallet);

  const gateFor = (policyId: bigint) =>
    publicClient.readContract({
      address: A.eligibilityGate,
      abi: GATE_ABI,
      functionName: 'isEligible',
      args: [identity ?? ZERO_ADDRESS, policyId],
    });
  const reasonFor = (hook: Address) =>
    publicClient.readContract({ address: hook, abi: HOOK_ABI, functionName: 'reasonFor', args: [wallet] });

  const [[dealOk], [investorOk], dealReason, investorReason] = await Promise.all([
    gateFor(P.deal.policyId),
    gateFor(P.investor.policyId),
    reasonFor(A.dealHook),
    reasonFor(A.investorHook),
  ]);

  const salt = saltOf(wallet);
  return {
    name,
    wallet,
    ens,
    identity,
    claims: {
      kyc: await claimState(identity, CLAIM_TOPICS.kyc, now),
      accredited: await claimState(identity, CLAIM_TOPICS.accredited, now),
    },
    access: {
      deal: { allowed: dealOk, reason: bytes32ToString(dealReason) || null },
      investor: { allowed: investorOk, reason: bytes32ToString(investorReason) || null },
    },
    positions: {
      deal: formatEther(positions.get(`${P.deal.id}|${salt}`) ?? 0n),
      investor: formatEther(positions.get(`${P.investor.id}|${salt}`) ?? 0n),
    },
    balances: await balancesOf(wallet),
  };
}

async function readOwners(ens: Record<DemoActor, DemoEns>) {
  return Promise.all(
    OWNERS.map(async (name) => ({
      name,
      wallet: actorAddress(name),
      ens: ens[name],
      compliant: await isCompliant(actorAddress(name)),
    })),
  );
}

/// The agent's row. `ens` is the one that matters: its name is a subname of ANA's and
/// resolves to HER identity, so its `compliance.status` is hers — the page reads the
/// relationship off `ens.principal` instead of asserting it.
async function readAgent(ens: DemoEns) {
  const A = addresses();
  const wallet = actorAddress('concierge');
  const [standing, casa, musd, perTxCap] = await Promise.all([
    publicClient.readContract({
      address: A.treasury,
      abi: TREASURY_ABI,
      functionName: 'isAgentInGoodStanding',
      args: [wallet],
    }),
    readBalance(A.casa, wallet),
    readBalance(A.musd, wallet),
    publicClient.readContract({ address: A.treasury, abi: TREASURY_ABI, functionName: 'agentPerTxCap' }),
  ]);
  return {
    wallet,
    ens,
    standing: { ok: standing[0], reason: bytes32ToString(standing[1]) || null },
    casa: fixed(casa),
    musd: fixed(musd),
    perTxCap: fixed(perTxCap),
  };
}

/// Walks the treasury's payment ids — 1..nextPaymentId-1, oldest first.
async function readPayments() {
  const A = addresses();
  const next = await publicClient.readContract({
    address: A.treasury,
    abi: TREASURY_ABI,
    functionName: 'nextPaymentId',
  });
  const ids: bigint[] = [];
  for (let id = 1n; id < next; id++) ids.push(id);
  const rows = await Promise.all(
    ids.map((id) =>
      publicClient.readContract({ address: A.treasury, abi: TREASURY_ABI, functionName: 'payments', args: [id] }),
    ),
  );
  return rows.map(([vendor, amount, evidenceHash, approvals, executed], i) => ({
    id: Number(ids[i]),
    vendor,
    // the treasury only knows the address; the name is config, so it is attached here
    vendorEns: ensNameForWallet(vendor),
    amount: fixed(amount),
    evidenceHash,
    approvals: Number(approvals),
    executed,
  }));
}

// ---------------------------------------------------------------- assembly

async function readWorld() {
  const A = addresses();
  const P = pools();
  const now = await chainNow();

  const logs = await refreshLogs();
  const { positions, totals } = aggregateLiquidity(logs) as {
    positions: Map<string, bigint>;
    totals: Map<string, bigint>;
  };
  const prices = lastPrices(logs) as Map<string, number>;

  const poolRow = (name: keyof typeof P) => ({
    hook: P[name].hook,
    policyId: Number(P[name].policyId),
    liquidity: Number(formatEther(totals.get(P[name].id) ?? 0n)).toFixed(0),
    price: (prices.get(P[name].id) ?? 1).toFixed(4),
  });

  // the whole name layer in one batch, before the rows that carry it — an actor appears
  // in several of them (ana is a markets actor, an owner AND the agent's principal) and
  // the resolver must not be asked the same question three times
  const ens = await ensWorld();

  const [actors, owners, agent, payments, treasuryMusd, approvalThreshold] = await Promise.all([
    Promise.all(IDENTITY_ACTORS.map((name) => actorState(name, now, positions, ens[name]))),
    readOwners(ens),
    readAgent(ens.concierge),
    readPayments(),
    readBalance(A.musd, A.treasury),
    publicClient.readContract({ address: A.treasury, abi: TREASURY_ABI, functionName: 'APPROVAL_THRESHOLD' }),
  ]);

  return {
    chainId: A.chainId,
    local: isLocal(),
    warped: isWarped(now),
    now,
    explorer: EXPLORER_URL,
    decider: process.env.DECIDER ?? 'mock',
    contracts: {
      issuerRegistry: A.issuerRegistry,
      claimIssuer: A.claimIssuer,
      identityFactory: A.identityFactory,
      eligibilityGate: A.eligibilityGate,
      poolManager: A.poolManager,
      swapRouter: A.swapRouter,
      liquidityRouter: A.liquidityRouter,
      dealHook: A.dealHook,
      investorHook: A.investorHook,
      treasury: A.treasury,
      mandateHook: A.mandateHook,
      token0: A.token0,
      token1: A.token1,
      casa: A.casa,
      musd: A.musd,
    },
    // every actor's wallet, including the two that hold no identity
    wallets: A.actors,
    // the hook demo's pair summary
    pool: { token0: A.token0Symbol, token1: A.token1Symbol, fee: A.fee },
    actors,
    pools: { deal: poolRow('deal'), investor: poolRow('investor'), house: poolRow('house') },
    // the concierge's own view of the same house pool, plus the treasury balance
    house: {
      treasuryMusd: fixed(treasuryMusd),
      poolLiquidity: Number(formatEther(totals.get(P.house.id) ?? 0n)).toFixed(0),
      poolPrice: (prices.get(P.house.id) ?? 1).toFixed(4),
      approvalThreshold: Number(approvalThreshold),
    },
    agent,
    owners,
    tickets: listTickets(),
    payments,
  };
}

// ---------------------------------------------------------------- handlers

export async function GET() {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    return jsonResponse(200, await readWorld());
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}

export async function POST(req: Request) {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    const body = (await req.json().catch(() => ({}))) as { action?: string; days?: number | string };
    if (body.action === 'reset') return jsonResponse(200, await resetWorld());
    if (body.action === 'timewarp') {
      const days = Number(body.days ?? 366);
      if (!Number.isFinite(days) || days <= 0) return jsonResponse(400, { ok: false, message: 'bad days' });
      return jsonResponse(200, await timewarp(days));
    }
    return jsonResponse(400, { ok: false, message: "unknown action — expected 'reset' or 'timewarp'" });
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}
