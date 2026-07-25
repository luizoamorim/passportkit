'use client';

/**
 * `/` — the landing page, which is the story rather than a menu.
 *
 * Four steps in the order a visitor walks them — get verified, enter the Deal
 * Room, trade a compliant pool, hand an agent a mandate — each one a link into
 * its own route and each one showing the live state of that surface, read from
 * `GET /api/demo/world`. The numbers are the point: a card that claims the
 * Deal Room is open while the pool refuses the same wallet would be a brochure.
 *
 * THE PAGE MUST RENDER WITHOUT THE DEMO RUNTIME. A 403 from `/api/demo/world`
 * (`DEMO_MODE` unset — the deployed build) is an expected answer, not a
 * failure: the four steps and their links stay, only the live rows fall back to
 * `—`. Same for a wallet that is not connected, or is connected but is not one
 * of the demo actors — the story then reads about Ana instead of about you.
 *
 * Everything live here comes off the chain (claim statuses, gate reason codes,
 * pool liquidity) and is rendered as text, never as HTML.
 */

import Link from 'next/link';
import { useMemo } from 'react';

import { ReasonBadge } from '@/components/demo/ReasonBadge';
import { StatusPill, toneForStatus } from '@/components/demo/StatusPill';
import { useDemoWorld, type DemoActorState, type DemoWorldState } from '@/components/demo/useDemoWorld';
import { useWallet } from '@/components/shell/AppShell';
import { RESOURCE_NAME, TENANT_NAME } from '@/modules/passport/passport.constants';

/// The shell already polls the world for the chain chip; this is the second
/// reader, so keep it lazy — nothing here is a write that needs catching up.
const POLL_MS = 15_000;

// ---------------------------------------------------------------- derivations

/** The passport vocabulary `/passport` and `/deal-room` speak, derived from the two claims. */
type PassportLabel = 'NONE' | 'LIMITED' | 'GREEN' | 'REVOKED' | 'EXPIRED';

function passportOf(actor: DemoActorState): PassportLabel {
  const { kyc, accredited } = actor.claims;
  // KYC is the gate for everything; accreditation only widens it.
  if (kyc.status === 'REVOKED') return 'REVOKED';
  if (kyc.status === 'EXPIRED') return 'EXPIRED';
  if (kyc.status !== 'VERIFIED') return 'NONE';
  return accredited.status === 'VERIFIED' ? 'GREEN' : 'LIMITED';
}

const titleCase = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const whole = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : value;
};

// ---------------------------------------------------------------- primitives

const DASH = <span className="font-mono text-xs text-[#9CA3AF]">—</span>;

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs font-semibold text-[#0D1428]">{children}</span>;
}

/** One live row inside a step card: what it is on the left, what it says on the right. */
function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">{label}</span>
      {children}
    </div>
  );
}

interface Step {
  n: string;
  href: string;
  title: string;
  desc: string;
  cta: string;
  stats: React.ReactNode;
}

function StepCard({ step }: { step: Step }) {
  return (
    <Link
      href={step.href}
      className="group flex flex-col rounded-2xl border border-[#DDE1EA] bg-white p-5 shadow-sm transition-colors hover:border-[#4A9EFF]"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold tracking-widest text-[#4A9EFF]">{step.n}</span>
        <span className="font-mono text-[10px] text-[#9CA3AF] transition-colors group-hover:text-[#4A9EFF]">
          {step.href}
        </span>
      </div>

      <p className="mt-3 text-base font-bold text-[#0D1428]">{step.title}</p>
      <p className="mt-1.5 flex-1 text-xs leading-relaxed text-[#4B5568]">{step.desc}</p>

      <div className="mt-4 flex flex-col gap-2 border-t border-[#DDE1EA] pt-3">{step.stats}</div>

      <span className="mt-3 text-xs font-semibold text-[#0D1428] transition-colors group-hover:text-[#4A9EFF]">
        {step.cta} →
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------- page

export default function LandingPage() {
  const { world, error, ready } = useDemoWorld(POLL_MS);
  const { address } = useWallet();

  /**
   * Who the four cards are about. The connected wallet when it is one of the
   * demo actors, otherwise Ana — the half-verified investor the story is
   * written around (KYC yes, accreditation no: LIMITED on purpose).
   */
  const subject = useMemo<DemoActorState | null>(() => {
    if (!world) return null;
    const mine = address
      ? world.actors.find((actor) => actor.wallet.toLowerCase() === address.toLowerCase())
      : undefined;
    return mine ?? world.actors.find((actor) => actor.name === 'ana') ?? world.actors[0] ?? null;
  }, [world, address]);

  const isMine = !!(subject && address && subject.wallet.toLowerCase() === address.toLowerCase());
  const who = subject ? (isMine ? 'your' : `${titleCase(subject.name)}'s`) : 'your';

  const steps = buildSteps(world, subject, who);

  return (
    <div className="flex-1 bg-[#F0F2F6]">
      {/* Thesis */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-10">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">
          PassportKit · One wallet, four surfaces
        </p>
        <h1 className="max-w-[20ch] text-[42px] font-bold leading-[1.1] text-[#0D1428]">
          An agent&apos;s authority is{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            borrowed from verified humans
          </span>{' '}
          — and one revoke flips every surface.
        </h1>
        <p className="mt-5 max-w-[70ch] text-base text-[#4B5568]">
          Walk it in order. Each step below is a live route on this site, reading the same claims on the same chain:
          the passport you hold, the room it unlocks, the pool that checks it before every swap, and the agent that
          can only spend while the humans behind it stay compliant.
        </p>
        <p className="mt-3 text-xs text-[#9CA3AF]">
          Demo tenant: {TENANT_NAME} · {RESOURCE_NAME}
        </p>
      </section>

      {/* The four steps */}
      <section className="max-w-6xl mx-auto px-6 pb-14">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <StepCard key={step.href} step={step} />
          ))}
        </div>

        {!world && (
          <p className="mt-4 text-xs text-[#9CA3AF]">
            {ready ? (error ?? 'No demo world yet.') : 'Reading the demo world…'} The four steps still link through —
            the live numbers appear once the local demo runtime is up.
          </p>
        )}
      </section>

      {/* The payoff */}
      <section className="bg-[#0D1428] py-14">
        <div className="max-w-6xl mx-auto px-6">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-4">Then revoke</p>
          <h2 className="max-w-[24ch] text-2xl font-bold leading-snug text-white">
            One claim comes off, and all four surfaces change their answer.
          </h2>
          <p className="mt-4 max-w-[74ch] text-sm leading-relaxed text-[#8FA0C0]">
            Revoke {who} KYC claim on Markets and nothing else has to be told: the passport reads REVOKED, the Deal
            Room locks, the pool reverts the next swap, and the agent the owners funded loses the right to spend
            their money. Same registry, same gate, four refusals — each one carrying the reason code the chain
            actually returned.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {['MISSING_KYC', 'OWNER_NOT_COMPLIANT', 'MANDATE_REVOKED'].map((code) => (
              <span
                key={code}
                className="rounded-md border border-[#1E2D4D] bg-[#172040] px-2 py-1 font-mono text-[10px] font-semibold text-[#8FA0C0]"
              >
                {code}
              </span>
            ))}
          </div>
          <Link
            href="/markets"
            className="mt-7 inline-block rounded-lg bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] px-6 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Revoke a claim on Markets →
          </Link>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- the story

/**
 * The four steps, with whatever the world can tell us about each one. Split out
 * so the narrative reads top to bottom in one place; `world === null` is the
 * no-runtime path and every live row falls back to a dash.
 */
function buildSteps(world: DemoWorldState | null, subject: DemoActorState | null, who: string): Step[] {
  const passport = subject ? passportOf(subject) : null;
  const deal = subject?.access.deal ?? null;
  const pool = world?.pools.deal ?? null;
  const agent = world?.agent ?? null;

  return [
    {
      n: '01',
      href: '/passport',
      title: 'Get verified',
      desc: 'Private evidence goes to the AI attester; Chainlink CRE writes the verdict as an onchain claim and the soulbound passport is issued. The documents never leave.',
      cta: 'Start the compliance flow',
      stats: (
        <>
          <Stat label={`${who} passport`}>
            {passport ? <StatusPill tone={toneForStatus(passport)}>{passport}</StatusPill> : DASH}
          </Stat>
          <Stat label="accredited claim">
            {subject ? (
              <StatusPill tone={toneForStatus(subject.claims.accredited.status)}>
                {subject.claims.accredited.status}
              </StatusPill>
            ) : (
              DASH
            )}
          </Stat>
        </>
      ),
    },
    {
      n: '02',
      href: '/deal-room',
      title: 'Enter the Deal Room',
      desc: 'The gated app never asks for a document. It asks the EligibilityGate whether this wallet holds a live KYC claim, and unlocks — or refuses with a code.',
      cta: 'Open the Deal Room',
      stats: (
        <>
          <Stat label={`${who} access`}>
            {!deal ? (
              DASH
            ) : deal.allowed ? (
              <StatusPill tone="good">ALLOWED</StatusPill>
            ) : (
              <ReasonBadge reason={deal.reason} message={deal.reason} />
            )}
          </Stat>
          <Stat label="checked by">
            <Mono>EligibilityGate</Mono>
          </Stat>
        </>
      ),
    },
    {
      n: '03',
      href: '/markets',
      title: 'Trade a compliant pool',
      desc: 'A Uniswap v4 hook calls that same gate before every swap and every liquidity add. No allowlist to maintain — and removing liquidity is never gated, so funds are never trapped.',
      cta: 'Swap through the hook',
      stats: (
        <>
          <Stat label="pool liquidity">{pool ? <Mono>{whole(pool.liquidity)}</Mono> : DASH}</Stat>
          <Stat label="pool price">{pool ? <Mono>{pool.price}</Mono> : DASH}</Stat>
        </>
      ),
    },
    {
      n: '04',
      href: '/concierge',
      title: 'Hand an agent a mandate',
      desc: 'Compliant owners grant a budget with a per-transaction cap. The agent decides, swaps and settles an x402 invoice on its own — and holds no authority the owners have not lent it.',
      cta: 'Give the agent a job',
      stats: (
        <>
          <Stat label="agent standing">
            {!agent ? (
              DASH
            ) : agent.standing.ok ? (
              <StatusPill tone="good">IN GOOD STANDING</StatusPill>
            ) : (
              <ReasonBadge reason={agent.standing.reason} message={agent.standing.reason} />
            )}
          </Stat>
          <Stat label="per-tx cap">{agent ? <Mono>{whole(agent.perTxCap)} mUSD</Mono> : DASH}</Stat>
        </>
      ),
    },
  ];
}
