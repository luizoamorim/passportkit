/**
 * GET /api/demo/tx/<hash> — the receipt, with every log named.
 *
 * The tx inspector both standalone demos shipped, on one event set: identity +
 * issuer, the house treasury, the v4 PoolManager and plain ERC-20/721 transfers.
 * Addresses come back as labels ("ClaimIssuer", "Identity (rui)", "mUSD") because
 * a wall of hex proves nothing to an audience — the point of the panel is that the
 * refusal and the approval are both legible on chain.
 *
 * Demo-only: DEMO_MODE must be 'true' or every method here is a 403.
 */
import { decodeEventLog, formatEther, type Abi, type Address, type Hex } from 'viem';

import { INSPECTOR_EVENTS, TRANSFER_EVENT_VARIANTS } from '@/lib/demo/abis';
import {
  addresses,
  assertDemo,
  demoDisabledResponse,
  demoEnabled,
  failure,
  jsonResponse,
  publicClient,
  short,
} from '@/lib/demo/chain';
import { CLAIM_TOPIC_NAMES, KEY_PURPOSES } from '@/lib/demo/identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/// Values a human can read: topic numbers become their claim names, 1e18-scale
/// amounts become "120.0000e18", ids and counters stay plain numbers.
function friendlyArg(name: string, value: unknown): string {
  if (typeof value === 'bigint') {
    if (name === 'topic' && CLAIM_TOPIC_NAMES[value.toString()]) return CLAIM_TOPIC_NAMES[value.toString()];
    if (name === 'purpose') return KEY_PURPOSES[value.toString()] ?? value.toString();
    if (name === 'expiresAt' || name === 'topic' || name === 'fee' || name === 'id' || name === 'approvals') {
      return value.toString();
    }
    const abs = value < 0n ? -value : value;
    if (abs >= 10n ** 12n) return `${Number(formatEther(value)).toFixed(4)}e18`;
    return value.toString();
  }
  return String(value);
}

/// Rebuilt per request: a world reset moves every address.
function labelsOf(): Record<string, string> {
  const A = addresses();
  const map: Record<string, string> = {
    [A.issuerRegistry.toLowerCase()]: 'IssuerRegistry',
    [A.claimIssuer.toLowerCase()]: 'ClaimIssuer',
    [A.identityFactory.toLowerCase()]: 'IdentityFactory',
    [A.eligibilityGate.toLowerCase()]: 'EligibilityGate',
    [A.poolManager.toLowerCase()]: 'PoolManager',
    [A.swapRouter.toLowerCase()]: 'SwapRouter',
    [A.liquidityRouter.toLowerCase()]: 'LiquidityRouter',
    [A.token0.toLowerCase()]: A.token0Symbol,
    [A.token1.toLowerCase()]: A.token1Symbol,
    [A.dealHook.toLowerCase()]: 'ComplianceHook (deal)',
    [A.investorHook.toLowerCase()]: 'ComplianceHook (investor)',
    [A.treasury.toLowerCase()]: 'HouseTreasury',
    [A.mandateHook.toLowerCase()]: 'MandateHook',
    [A.casa.toLowerCase()]: 'CASA',
    [A.musd.toLowerCase()]: 'mUSD',
  };
  for (const [name, identity] of Object.entries(A.identities ?? {})) {
    if (identity) map[identity.toLowerCase()] = `Identity (${name})`;
  }
  return map;
}

interface DecodedLog {
  contract: string;
  name: string;
  args?: Record<string, string>;
  topic?: string;
}

function decodeLog(log: { address: Address; data: Hex; topics: Hex[] }, labels: Record<string, string>): DecodedLog {
  const contract = labels[log.address.toLowerCase()] ?? short(log.address);
  for (const abi of [INSPECTOR_EVENTS, ...TRANSFER_EVENT_VARIANTS] as Abi[]) {
    try {
      const dec = decodeEventLog({ abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const args = (dec.args ?? {}) as Record<string, unknown>;
      if (!dec.eventName) continue;
      return {
        contract,
        name: dec.eventName,
        args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, friendlyArg(k, v)])),
      };
    } catch {
      // wrong event for this log — try the next ABI
    }
  }
  return { contract, name: 'unknown', topic: log.topics[0]?.slice(0, 10) };
}

async function inspectTx(hash: Hex) {
  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash }),
    publicClient.getTransaction({ hash }),
  ]);
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const labels = labelsOf();
  return {
    ok: true,
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
    timestamp: Number(block.timestamp),
    from: tx.from,
    to: tx.to,
    contract: tx.to ? (labels[tx.to.toLowerCase()] ?? short(tx.to)) : null,
    gasUsed: receipt.gasUsed.toString(),
    logs: receipt.logs.map((log) => decodeLog(log, labels)),
  };
}

export async function GET(_req: Request, { params }: { params: { hash: string } }) {
  if (!demoEnabled()) return demoDisabledResponse();
  try {
    assertDemo();
    if (!TX_HASH.test(params.hash)) return jsonResponse(400, { ok: false, message: 'bad tx hash' });
    return jsonResponse(200, await inspectTx(params.hash as Hex).catch(failure));
  } catch (err) {
    return jsonResponse(500, failure(err));
  }
}
