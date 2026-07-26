'use client';

/**
 * `/` — the landing. Deliberately minimal for the demo: only the login is
 * interactive. On connect we move straight to the guided `/hero` journey.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet, WalletConnectControl } from '@/components/shell/AppShell';

const FLOW = [
  { n: '01', t: 'Verify with World ID', d: 'A live-person check becomes an on-chain compliance claim.' },
  { n: '02', t: 'Get a live ENS name', d: 'name.casaazul.eth resolves your compliance status on-chain.' },
  { n: '03', t: 'Delegate to an agent', d: 'A new wallet inherits your eligibility (Model A).' },
  { n: '04', t: 'One revoke cuts it off', d: 'Revoke the human — the agent is blocked from Casa Azul liquidity.' },
];

export default function LandingPage() {
  const { address } = useWallet();
  const router = useRouter();

  // Login moves you into the guided flow.
  useEffect(() => {
    if (address) router.push('/hero');
  }, [address, router]);

  return (
    <div className="flex-1 bg-[#F0F2F6]">
      <section className="max-w-3xl mx-auto px-6 pt-24 pb-16 text-center">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
          PassportKit · live on Sepolia
        </p>
        <h1 className="text-[40px] font-bold leading-[1.1] text-[#0D1428]">
          One identity.{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            Humans and their agents.
          </span>
        </h1>
        <p className="mt-5 mx-auto max-w-[60ch] text-base text-[#4B5568]">
          Verify with World ID, get a live ENS name, delegate to an agent — then watch one revocation cut
          the agent off from Casa Azul&apos;s compliant liquidity.
        </p>

        <div className="mt-8 flex flex-col items-center gap-2">
          <WalletConnectControl />
          <p className="text-xs text-[#9CA3AF]">Login to begin.</p>
        </div>

        {/* Static preview — nothing here is clickable. */}
        <div className="mt-14 grid grid-cols-1 gap-3 sm:grid-cols-2 text-left">
          {FLOW.map((s) => (
            <div key={s.n} className="rounded-2xl border border-[#DDE1EA] bg-white p-4 shadow-sm">
              <span className="font-mono text-[11px] font-bold tracking-widest text-[#4A9EFF]">{s.n}</span>
              <p className="mt-1.5 text-sm font-bold text-[#0D1428]">{s.t}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#4B5568]">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
