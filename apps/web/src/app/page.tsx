'use client';

import Link from 'next/link';
import { Shell, Card } from '@/components/pk/kit';

const CARDS = [
  {
    href: '/passport',
    emoji: '🪪',
    title: 'My Passport',
    body: 'Create your on-chain identity, collect verified claims (KYC, World personhood, accredited), and watch your eligibility update live.',
  },
  {
    href: '/deal-room',
    emoji: '🏙️',
    title: 'Deal Room',
    body: 'A gated PropTech deal room. Access is decided by the same EligibilityGate — revoke a claim and it locks instantly.',
  },
  {
    href: '/agents',
    emoji: '🤖',
    title: 'My Agents',
    body: 'Spawn x402 agents under your identity. Each inherits your eligibility, gets a verifiable ENS name (ENSIP-25) and a reputation score.',
  },
];

export default function Home() {
  return (
    <Shell>
      <section className="py-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#4A9EFF]">
          Compliance credential rails for wallets, apps &amp; agents
        </p>
        <h1 className="mx-auto mt-3 max-w-2xl text-3xl font-bold leading-tight text-[#0D1428] md:text-4xl">
          Identity before access. Compliance before liquidity.
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-500">
          PassportKit turns compliance into a portable, revocation-aware credential. The hero isn&apos;t
          the green check — it&apos;s the <span className="font-semibold text-[#0D1428]">refusal</span>.
        </p>
      </section>

      <div className="mt-4 grid gap-5 md:grid-cols-3">
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <div className="text-3xl">{c.emoji}</div>
              <h3 className="mt-3 text-base font-bold text-[#0D1428]">{c.title}</h3>
              <p className="mt-1.5 text-sm text-slate-500">{c.body}</p>
              <p className="mt-4 text-xs font-semibold text-[#4A9EFF]">Open →</p>
            </Card>
          </Link>
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Demo tenant: <span className="font-mono">casaazul.eth</span> · one EligibilityGate behind
        every surface (app, ERC-20, ENS, Uniswap v4 hook).
      </p>
    </Shell>
  );
}
