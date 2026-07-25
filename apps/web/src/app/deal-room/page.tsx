'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shell, Card, Pill, Btn } from '@/components/pk/kit';
import { useWallet } from '@/lib/useWallet';
import { getState, type PassportState } from '@/lib/passportkit';

export default function DealRoomPage() {
  const { wallet } = useWallet();
  const [state, setState] = useState<PassportState | null>(null);

  const refresh = useCallback(async (w: string) => setState(await getState(w)), []);
  useEffect(() => {
    if (wallet) refresh(wallet);
    else setState(null);
  }, [wallet, refresh]);

  const dealOk = !!state?.dealRoom.ok;
  const investorOk = !!state?.investor.ok;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#0D1428]">Node PropTech Deal Room</h1>
        <p className="mt-1 text-sm text-slate-500">
          Access is gated live by the same EligibilityGate. Revoke a claim and this locks instantly.
        </p>
      </div>

      {(!wallet || !state?.identity) && (
        <LockedBanner
          title="Locked"
          reason="Connect a wallet and create your identity to request access."
          cta
        />
      )}

      {wallet && state?.identity && !dealOk && (
        <LockedBanner title="Locked" reason={`Deal Room needs KYC — gate says ${state.dealRoom.reason}.`} cta />
      )}

      {wallet && state?.identity && dealOk && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-teal-200 bg-teal-50 p-5">
            <div className="flex items-center gap-2">
              <Pill tone="green">✓ Deal Room unlocked</Pill>
              <span className="text-xs text-slate-500">policy #1 satisfied (KYC)</span>
            </div>
            <p className="mt-3 text-sm text-teal-800">
              Welcome. You can browse deals, data rooms, and documents.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {['Blue Tower · Lisbon', 'Riverside Lofts', 'Harbor Logistics'].map((d) => (
              <Card key={d} title={d} subtitle="PropTech deal">
                <div className="h-16 rounded-lg bg-gradient-to-br from-slate-100 to-slate-200" />
                <p className="mt-3 text-xs text-slate-500">Target IRR 14% · Data room available</p>
              </Card>
            ))}
          </div>

          <Card
            title="Investor area"
            subtitle="Restricted to accredited investors (policy #2)."
            className={investorOk ? 'ring-1 ring-teal-200' : ''}
          >
            {investorOk ? (
              <div>
                <Pill tone="green">✓ investor access</Pill>
                <p className="mt-3 text-sm text-slate-600">
                  Subscribe, commit capital, and view the cap table.
                </p>
              </div>
            ) : (
              <div>
                <Pill tone="amber">limited</Pill>
                <p className="mt-3 text-sm text-slate-600">
                  You can browse, but investing needs the Accredited Investor claim ·{' '}
                  <span className="font-mono text-xs">{state.investor.reason}</span>.
                </p>
                <Link href="/passport" className="mt-2 inline-block text-xs font-semibold text-[#4A9EFF] hover:underline">
                  Get accredited on My Passport →
                </Link>
              </div>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}

function LockedBanner({ title, reason, cta }: { title: string; reason: string; cta?: boolean }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <div className="text-3xl">🔒</div>
      <h2 className="mt-2 text-lg font-bold text-red-700">{title}</h2>
      <p className="mt-1 text-sm text-red-600">{reason}</p>
      {cta && (
        <Link href="/passport" className="mt-4 inline-block">
          <Btn>Go to My Passport</Btn>
        </Link>
      )}
    </div>
  );
}
