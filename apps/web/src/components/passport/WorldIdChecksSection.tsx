'use client';

import { useCallback, useEffect, useState } from 'react';
import { WorldIdCheckCard } from './WorldIdCheckCard';
import {
  createIdentity,
  getEligibility,
  type EligibilityState,
  type WorldCheck,
} from '@/modules/passport/world-id.service';

const CHECKS: WorldCheck[] = ['personhood', 'selfie', 'identity'];

/**
 * The World ID row of the passport page: Proof of Human, Selfie Check (beta) and
 * Identity Check (preview). Owns the eligibility read (identity address + per-check
 * status) so the page itself stays on the passport/claims state it already had.
 */
export function WorldIdChecksSection({ wallet }: { wallet: string }) {
  const [state, setState] = useState<EligibilityState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (ensureIdentity = false) => {
    try {
      let next = await getEligibility(wallet);
      if (ensureIdentity && !next.identity) {
        await createIdentity(wallet);
        next = await getEligibility(wallet);
      }
      setState(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load World ID status.');
    }
  }, [wallet]);

  useEffect(() => {
    setState(null);
    refresh(true);
  }, [refresh]);

  return (
    <div className="mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF]">World ID</p>
        {state?.identity && (
          <p className="text-[10px] font-mono text-[#9CA3AF]">identity {state.identity.slice(0, 10)}…</p>
        )}
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">
          {error}{' '}
          <button onClick={() => refresh(true)} className="underline ml-1">Retry</button>
        </div>
      )}
      {state && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {CHECKS.map((check) => (
            <WorldIdCheckCard
              key={check}
              check={check}
              wallet={wallet}
              identity={state.identity}
              status={state.checks?.[check] ?? 'UNVERIFIED'}
              mode={state.mode}
              onComplete={async () => { await refresh(); }}
            />
          ))}
        </div>
      )}
      {!state && !error && <p className="text-sm text-[#4B5568]">Loading World ID status…</p>}
    </div>
  );
}
