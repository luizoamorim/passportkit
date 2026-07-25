'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, Card, Pill, Btn, short } from '@/components/pk/kit';
import { useWallet } from '@/lib/useWallet';
import {
  getState,
  linkAgent,
  unlinkAgent,
  revokeClaim,
  reinstateClaim,
  type PassportState,
} from '@/lib/passportkit';

export default function AgentsPage() {
  const { wallet } = useWallet();
  const [state, setState] = useState<PassportState | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async (w: string) => setState(await getState(w)), []);
  useEffect(() => {
    if (wallet) refresh(wallet);
    else setState(null);
  }, [wallet, refresh]);

  const run = async (id: string, fn: () => Promise<PassportState>) => {
    setBusy(id);
    try {
      setState(await fn());
    } finally {
      setBusy(null);
    }
  };

  const kycRevoked = !!state?.revoked.KYC_VERIFIED && !!state?.claims.KYC_VERIFIED;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0D1428]">My Agents</h1>
        <p className="mt-1 text-sm text-slate-500">
          Spawn x402 agents under your identity. Each inherits your eligibility (Model A) and gets a
          verifiable ENS name + reputation score.
        </p>
      </div>

      {!wallet && <Card><p className="text-sm text-slate-600">Connect a wallet to begin.</p></Card>}

      {wallet && state && !state.identity && (
        <Card>
          <p className="text-sm text-slate-600">
            You need an identity first.{' '}
            <Link href="/passport" className="font-semibold text-[#4A9EFF] hover:underline">
              Create it on My Passport →
            </Link>
          </p>
        </Card>
      )}

      {wallet && state && state.identity && (
        <div className="space-y-5">
          {/* money moment control */}
          <Card
            title="The money moment"
            subtitle="Revoke your KYC and every surface — and every agent — refuses at once."
            className={kycRevoked ? 'ring-2 ring-red-200' : ''}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">Your KYC:</span>
                {kycRevoked ? <Pill tone="red">REVOKED</Pill> : <Pill tone="green">✓ valid</Pill>}
              </div>
              {kycRevoked ? (
                <Btn
                  variant="ghost"
                  onClick={() => run('kyc', () => reinstateClaim(wallet, 'KYC_VERIFIED'))}
                  disabled={!!busy}
                >
                  Re-issue KYC
                </Btn>
              ) : (
                <Btn
                  variant="danger"
                  onClick={() => run('kyc', () => revokeClaim(wallet, 'KYC_VERIFIED'))}
                  disabled={!!busy || !state.claims.KYC_VERIFIED}
                >
                  Revoke KYC
                </Btn>
              )}
            </div>
            {!state.claims.KYC_VERIFIED && (
              <p className="mt-2 text-[11px] text-amber-600">
                Verify KYC on My Passport first to demo the revoke.
              </p>
            )}
          </Card>

          {/* link a new agent */}
          <Card title="Spawn an agent" subtitle="One call: linkAgent + issue the ENS subname.">
            <div className="flex items-center gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="label (e.g. atlas)"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#4A9EFF]"
              />
              <Btn
                onClick={() =>
                  run('link', async () => {
                    const s = await linkAgent(wallet, label || undefined);
                    setLabel('');
                    return s;
                  })
                }
                disabled={!!busy}
              >
                {busy === 'link' ? 'Linking…' : 'Spawn agent'}
              </Btn>
            </div>
          </Card>

          {/* agent list */}
          {state.agents.length === 0 ? (
            <Card><p className="text-xs text-slate-400">No agents yet.</p></Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {state.agents.map((a) => (
                <Card key={a.wallet} className={a.eligibleDealRoom ? '' : 'opacity-70'}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-bold text-[#0D1428]">{a.subname}</p>
                      <p className="font-mono text-[11px] text-slate-400">{short(a.wallet)}</p>
                    </div>
                    <button
                      onClick={() => run(a.wallet, () => unlinkAgent(wallet, a.wallet))}
                      className="text-[11px] text-slate-400 hover:text-red-500"
                      disabled={!!busy}
                    >
                      unlink
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {a.verified && <Pill tone="blue">ENSIP-25 verified</Pill>}
                    <Pill tone="green">score {a.score}</Pill>
                    {a.eligibleDealRoom ? (
                      <Pill tone="green">✓ can act</Pill>
                    ) : (
                      <Pill tone="red">blocked (person)</Pill>
                    )}
                  </div>
                  <p className="mt-3 text-[11px] text-slate-400">
                    Resolves live on ENS: <span className="font-mono">agent-registration</span> = &quot;1&quot;,{' '}
                    <span className="font-mono">agent.reputation</span> = &quot;{a.score}&quot;
                  </p>
                </Card>
              ))}
            </div>
          )}

          {kycRevoked && state.agents.length > 0 && (
            <p className="text-center text-xs font-semibold text-red-600">
              KYC revoked → all {state.agents.length} agent(s) blocked at once. That&apos;s the cascade.
            </p>
          )}
        </div>
      )}
    </Shell>
  );
}
