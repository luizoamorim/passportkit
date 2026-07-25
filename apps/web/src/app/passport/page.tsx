'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, Card, Pill, Btn, short } from '@/components/pk/kit';
import { useWallet } from '@/lib/useWallet';
import {
  createIdentity,
  getState,
  verifyClaim,
  reinstateClaim,
  resetDemo,
  TOPICS,
  TOPIC_LABELS,
  type PassportState,
  type Topic,
} from '@/lib/passportkit';

const STATUS_TONE = { NONE: 'slate', LIMITED: 'blue', GREEN: 'green', RED: 'red' } as const;

export default function PassportPage() {
  const { wallet } = useWallet();
  const [state, setState] = useState<PassportState | null>(null);
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

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0D1428]">My Passport</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create your on-chain identity, collect verified claims, and see your live eligibility.
        </p>
      </div>

      {!wallet && (
        <Card>
          <p className="text-sm text-slate-600">
            Connect a wallet (or use the demo wallet) in the top-right to begin.
          </p>
        </Card>
      )}

      {wallet && state && (
        <div className="grid gap-5 md:grid-cols-3">
          {/* left: identity + claims */}
          <div className="space-y-5 md:col-span-2">
            <Card
              title="Identity"
              subtitle="Backend provisions it (AGENT_ROLE); your wallet is the management key."
            >
              {!state.identity ? (
                <Btn onClick={() => run('id', () => createIdentity(wallet))} disabled={busy === 'id'}>
                  {busy === 'id' ? 'Creating…' : 'Create my identity'}
                </Btn>
              ) : (
                <div>
                  <Pill tone="green">✓ identity created</Pill>
                  <p className="mt-2 font-mono text-xs text-slate-500">{state.identity}</p>
                </div>
              )}
            </Card>

            <Card
              title="Claims"
              subtitle="Verify evidence → issuer signs → you submit (Model B). World = personhood."
            >
              <div className="space-y-3">
                {TOPICS.map((t: Topic) => {
                  const verified = state.claims[t] && !state.revoked[t];
                  const revoked = state.claims[t] && state.revoked[t];
                  return (
                    <div
                      key={t}
                      className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#0D1428]">{TOPIC_LABELS[t]}</p>
                        <p className="text-[11px] text-slate-400">{t}</p>
                      </div>
                      {verified ? (
                        <Pill tone="green">✓ VERIFIED</Pill>
                      ) : revoked ? (
                        <div className="flex items-center gap-2">
                          <Pill tone="red">REVOKED</Pill>
                          <Btn
                            variant="ghost"
                            onClick={() => run(t, () => reinstateClaim(wallet, t))}
                            disabled={!!busy}
                          >
                            Re-issue
                          </Btn>
                        </div>
                      ) : (
                        <Btn
                          onClick={() => run(t, () => verifyClaim(wallet, t))}
                          disabled={!state.identity || !!busy}
                        >
                          {busy === t ? 'Verifying…' : 'Verify'}
                        </Btn>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Transaction timeline">
              {state.txs.length === 0 ? (
                <p className="text-xs text-slate-400">No transactions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {state.txs.map((tx) => (
                    <li key={tx.hash} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600">{tx.label}</span>
                      <span className="font-mono text-slate-400">{short(tx.hash)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => {
                  resetDemo(wallet);
                  refresh(wallet);
                }}
                className="mt-4 text-[11px] text-slate-400 hover:text-red-500"
              >
                Reset demo state
              </button>
            </Card>
          </div>

          {/* right: passport status + eligibility */}
          <div className="space-y-5">
            <Card title="Passport status">
              <div className="flex items-center justify-center py-4">
                <div className="text-center">
                  <div className="text-3xl">
                    {state.status === 'GREEN'
                      ? '🟢'
                      : state.status === 'LIMITED'
                        ? '🔵'
                        : state.status === 'RED'
                          ? '🔴'
                          : '⚪'}
                  </div>
                  <div className="mt-2">
                    <Pill tone={STATUS_TONE[state.status]}>{state.status}</Pill>
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Eligibility" subtitle="One gate, read live.">
              <div className="space-y-3">
                <EligibilityRow label="Deal Room" hint="policy #1 · KYC" e={state.dealRoom} />
                <EligibilityRow
                  label="Investor"
                  hint="policy #2 · KYC + Accredited"
                  e={state.investor}
                />
              </div>
              <Link
                href="/deal-room"
                className="mt-4 block text-center text-xs font-semibold text-[#4A9EFF] hover:underline"
              >
                Go to the Deal Room →
              </Link>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

function EligibilityRow({
  label,
  hint,
  e,
}: {
  label: string;
  hint: string;
  e: { ok: boolean; reason: string };
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2.5">
      <div>
        <p className="text-sm font-semibold text-[#0D1428]">{label}</p>
        <p className="text-[11px] text-slate-400">{hint}</p>
      </div>
      {e.ok ? <Pill tone="green">✓ eligible</Pill> : <Pill tone="red">{e.reason}</Pill>}
    </div>
  );
}
