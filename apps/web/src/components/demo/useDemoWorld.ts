'use client';

/**
 * `GET /api/demo/world` for the demo pages: the whole world in one poll.
 *
 * The shell polls the same route for the chain chip, but it only needs
 * `{chainId, local, warped, now}` and a lazy 15s cadence. A demo page is driven
 * by the rest of the payload and has to catch up right after a write, so it
 * keeps its own faster copy and exposes `refresh()` for the action handlers.
 *
 * The types below mirror `src/app/api/demo/world/route.ts` — the markets half
 * (actors, pools) and the concierge half (house, agent, owners, tickets,
 * payments) both live here so both pages read one shape.
 *
 * CLIENT SAFE: this only ever speaks to `/api/demo/*`, never to `lib/demo/*`
 * (which holds the actor private keys and must stay in the server bundle).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type DemoClaimStatus = 'UNVERIFIED' | 'VERIFIED' | 'REVOKED' | 'EXPIRED';

export interface DemoClaim {
  status: DemoClaimStatus;
  /** unix seconds, chain clock — null when there is no claim */
  expiresAt: number | null;
}

/** One `EligibilityGate.isEligible` verdict: allowed, plus the gate's reason code. */
export interface DemoAccess {
  allowed: boolean;
  reason: string | null;
}

export interface DemoActorState {
  name: string;
  wallet: string;
  identity: string | null;
  claims: { kyc: DemoClaim; accredited: DemoClaim };
  access: { deal: DemoAccess; investor: DemoAccess };
  positions: { deal: string; investor: string };
  /** keyed by token symbol, e.g. `{ PROP: '100.00', mUSD: '100.00' }` */
  balances: Record<string, string>;
}

export interface DemoPoolRow {
  hook: string;
  policyId: number;
  liquidity: string;
  price: string;
}

export interface DemoOwner {
  name: string;
  wallet: string;
  compliant: boolean;
}

export interface DemoAgent {
  wallet: string;
  standing: { ok: boolean; reason: string | null };
  casa: string;
  musd: string;
  perTxCap: string;
}

export interface DemoPayment {
  id: number;
  vendor: string;
  amount: string;
  evidenceHash: string;
  approvals: number;
  executed: boolean;
}

export interface DemoTicketRow {
  id: number;
  description: string;
  category: string;
  vendor: string;
  amount: string;
  decision: { action: string; rationale: string; confidence: number };
  evidenceHash: string;
  txHashes: string[];
  refusal: { reason: string; wallet: string | null; message: string; source?: string } | null;
  settleError: string | null;
  paid: boolean;
  paymentId: number | null;
  status: string;
  at: number;
}

export interface DemoWorldState {
  chainId: number;
  local: boolean;
  warped: boolean;
  /** chain clock, unix seconds */
  now: number;
  explorer: string | null;
  decider: string;
  contracts: Record<string, string>;
  wallets: Record<string, string>;
  pool: { token0: string; token1: string; fee: number };
  actors: DemoActorState[];
  pools: { deal: DemoPoolRow; investor: DemoPoolRow; house: DemoPoolRow };
  house: { treasuryMusd: string; poolLiquidity: string; poolPrice: string; approvalThreshold: number };
  agent: DemoAgent;
  owners: DemoOwner[];
  tickets: DemoTicketRow[];
  payments: DemoPayment[];
}

export interface DemoWorldHandle {
  world: DemoWorldState | null;
  /** set only while the world is unreadable — the last good world stays on screen */
  error: string | null;
  /** true once the first answer (good or bad) has landed */
  ready: boolean;
  /**
   * The build has no demo runtime at all (`DEMO_MODE` unset → 403), as opposed
   * to a runtime that is up and merely unhappy. The two need different copy:
   * one is fixed with `make demo`, the other with a look at the chain.
   */
  runtimeOff: boolean;
  refresh: () => Promise<void>;
}

const DEFAULT_POLL_MS = 6_000;

export function useDemoWorld(pollMs: number = DEFAULT_POLL_MS): DemoWorldHandle {
  const [world, setWorld] = useState<DemoWorldState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [runtimeOff, setRuntimeOff] = useState(false);

  /**
   * Latched by a 403: this build has no demo runtime, so polling it again can
   * only produce the same 403 — every 6s, in every visitor's console, on the
   * one page a non-demo deployment actually serves (`/`). Same terminal answer
   * the shell's own probe stops on; a server started with `DEMO_MODE=true`
   * needs a reload either way, since the shell latches too.
   */
  const off = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/demo/world', { cache: 'no-store' });
      if (res.status === 403) {
        off.current = true;
        setRuntimeOff(true);
        setError('Demo runtime is off — start the server with DEMO_MODE=true.');
        setWorld(null);
        return;
      }
      if (!res.ok) {
        // The runtime is up and the chain is unhappy (no world deployed, RPC
        // down). Keep the last good world rendered rather than blanking it.
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setError(body.message ?? `world read failed (${res.status})`);
        return;
      }
      setWorld((await res.json()) as DemoWorldState);
      setError(null);
    } catch {
      setError('Cannot reach the demo server.');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      await refresh();
      if (!cancelled && !off.current) timer = setTimeout(tick, pollMs);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, pollMs]);

  return { world, error, ready, runtimeOff, refresh };
}
