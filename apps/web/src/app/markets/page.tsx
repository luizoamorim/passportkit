'use client';

/**
 * `/markets` — the ComplianceHook surface: two Uniswap v4 pools on the same
 * `EligibilityGate`, one per policy.
 *
 * The whole page is one loop: read `GET /api/demo/world`, render every actor's
 * claims and both pools' verdicts, act through `POST /api/demo/markets`, re-read.
 *
 * A REFUSAL IS A 200 with `{ok:false, reason, …}` — the chain saying no is the
 * demo, not an error — so every handler branches on `ok`, never on the HTTP
 * status, and always puts the gate's own reason code on screen.
 *
 * Everything rendered here (reason codes, refusal messages, addresses, decoded
 * event args) comes off the chain: it is rendered as text, never as HTML.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { ActionButton } from '@/components/demo/ActionButton';
import { ActorCard, type ActorCardRow } from '@/components/demo/ActorCard';
import { ReasonBadge } from '@/components/demo/ReasonBadge';
import { StatusPill, toneForStatus } from '@/components/demo/StatusPill';
import { TxInspector } from '@/components/demo/TxInspector';
import { TxLog, type TxLogEntry, type TxLogTone } from '@/components/demo/TxLog';
import {
  useDemoWorld,
  type DemoAccess,
  type DemoActorState,
  type DemoClaim,
  type DemoPoolRow,
  type DemoWorldState,
} from '@/components/demo/useDemoWorld';

// ---------------------------------------------------------------- vocabulary

type MarketPool = 'deal' | 'investor';
type ClaimName = 'kyc' | 'accredited';

const POOLS: { name: MarketPool; label: string; short: string; policy: string }[] = [
  { name: 'deal', label: 'Deal Room pool', short: 'Deal', policy: 'KYC' },
  { name: 'investor', label: 'Investor pool', short: 'Investor', policy: 'KYC + Accredited' },
];

const CLAIM_LABELS: Record<ClaimName, string> = {
  kyc: 'KYC_VERIFIED',
  accredited: 'ACCREDITED_INVESTOR',
};

/// Who the audience is looking at. An unknown actor simply gets no strapline.
const ROLES: Record<string, string> = {
  operator: 'Admin, issuer signer & liquidity provider',
  ana: 'Investor with KYC — accreditation still pending',
  rui: 'Stranger — identity, zero claims',
};

// ---------------------------------------------------------------- helpers

const short = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

const lp = (value: string) => Number(value).toFixed(1);

const expiryOf = (claim: DemoClaim) =>
  claim.expiresAt ? `exp ${new Date(claim.expiresAt * 1000).toISOString().slice(0, 10)}` : '';

const fmtDelta = (delta?: Record<string, string>) =>
  delta
    ? Object.entries(delta)
        .map(([symbol, value]) => `${Number(value) >= 0 ? '+' : ''}${value} ${symbol}`)
        .join(', ')
    : '';

const feeLabel = (fee: number) => `${Number((fee / 10_000).toFixed(2))}%`;

/** What `POST /api/demo/markets` answers with — refusals included, at status 200. */
interface MarketsResult {
  ok: boolean;
  reason?: string | null;
  message?: string;
  txHash?: string;
  txHashes?: string[];
  delta?: Record<string, string>;
  position?: string;
}

interface MarketsRequest {
  action: 'swap' | 'liquidity' | 'verify' | 'revoke';
  actor: string;
  pool?: MarketPool;
  claim?: ClaimName;
  direction?: 'add' | 'remove';
  zeroForOne?: boolean;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Every /api/demo/* answer is JSON — a refusal at 200, a bad request at 4xx,
  // a broken chain at 5xx. Anything that is not JSON is the dev server itself.
  return (await res.json().catch(() => ({ ok: false, message: `unreadable response (${res.status})` }))) as T;
}

// ---------------------------------------------------------------- page

export default function MarketsPage() {
  const { world, error, ready, refresh } = useDemoWorld();
  const [entries, setEntries] = useState<TxLogEntry[]>([]);
  const [busy, setBusy] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const counter = useRef(0);

  const push = useCallback(
    (entry: { tone: TxLogTone; message: string; outcome?: string; detail?: string; hashes?: string[] }) => {
      counter.current += 1;
      setEntries((prev) => [{ id: `e${counter.current}`, at: Date.now(), ...entry }, ...prev]);
    },
    [],
  );

  /// One actor at a time: their buttons go disabled for the round trip, and the
  /// world is re-read afterwards whatever happened.
  const act = useCallback(
    async (actor: string, run: () => Promise<void>) => {
      setBusy((prev) => (prev.includes(actor) ? prev : [...prev, actor]));
      try {
        await run();
      } finally {
        setBusy((prev) => prev.filter((name) => name !== actor));
        await refresh();
      }
    },
    [refresh],
  );

  const call = useCallback((body: MarketsRequest) => postJson<MarketsResult>('/api/demo/markets', body), []);

  // ------------------------------------------------------------ actions

  const swap = useCallback(
    (actor: string, pool: MarketPool, zeroForOne: boolean, pair: string) =>
      act(actor, async () => {
        const res = await call({ action: 'swap', actor, pool, zeroForOne });
        const what = `${actor} swap ${pair} on ${pool} pool`;
        if (res.ok) {
          push({ tone: 'good', message: what, outcome: `filled (${fmtDelta(res.delta)})`, hashes: hashesOf(res) });
        } else {
          push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
        }
      }),
    [act, call, push],
  );

  const liquidity = useCallback(
    (actor: string, pool: MarketPool, direction: 'add' | 'remove') =>
      act(actor, async () => {
        const res = await call({ action: 'liquidity', actor, pool, direction });
        const what = `${actor} ${direction === 'remove' ? 'exit' : 'add'} 2 LP on ${pool} pool`;
        if (res.ok) {
          push({
            tone: 'good',
            message: what,
            outcome: `done (${fmtDelta(res.delta)} · position now ${lp(res.position ?? '0')})`,
            hashes: hashesOf(res),
          });
        } else {
          push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
        }
      }),
    [act, call, push],
  );

  const verify = useCallback(
    (actor: string, claim: ClaimName) =>
      act(actor, async () => {
        const res = await call({ action: 'verify', actor, claim });
        const what = `issuer: verify ${CLAIM_LABELS[claim]} for ${actor}`;
        if (res.ok) push({ tone: 'good', message: what, outcome: 'claim valid', hashes: hashesOf(res) });
        else push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
      }),
    [act, call, push],
  );

  const revoke = useCallback(
    (actor: string, claim?: ClaimName) =>
      act(actor, async () => {
        const res = await call({ action: 'revoke', actor, ...(claim ? { claim } : {}) });
        const what = `issuer: revoke ${claim ? CLAIM_LABELS[claim] : 'every claim'} of ${actor}`;
        if (res.ok) push({ tone: 'good', message: what, outcome: 'latch closed', hashes: hashesOf(res) });
        else push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
      }),
    [act, call, push],
  );

  const timewarp = useCallback(
    () =>
      act('world', async () => {
        const res = await postJson<{ ok: boolean; warpedDays?: number; message?: string }>('/api/demo/world', {
          action: 'timewarp',
          days: 366,
        });
        if (res.ok) {
          push({ tone: 'good', message: 'world: fast-forward', outcome: `${res.warpedDays} days — claims expire` });
        } else {
          push({ tone: 'bad', message: 'world: fast-forward', outcome: 'refused', detail: res.message });
        }
      }),
    [act, push],
  );

  const reset = useCallback(
    () =>
      act('world', async () => {
        push({ tone: 'info', message: 'world: resetting chain + redeploying', outcome: '…' });
        const res = await postJson<{ ok: boolean; message?: string }>('/api/demo/world', { action: 'reset' });
        if (!res.ok) {
          push({ tone: 'bad', message: 'world: reset', outcome: 'refused', detail: res.message });
          return;
        }
        // every address moved — the hashes above point at a chain that is gone
        counter.current += 1;
        setInspecting(null);
        setEntries([
          {
            id: `e${counter.current}`,
            at: Date.now(),
            tone: 'good',
            message: 'world: reset',
            outcome: 'fresh chain, fresh contracts, clock back to today — both demos',
          },
        ]);
      }),
    [act, push],
  );

  const busySet = useMemo(() => new Set(busy), [busy]);

  // ------------------------------------------------------------ render

  return (
    <div className="flex-1 bg-[#F0F2F6]">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
          Uniswap v4 · Surface #4
        </p>
        <h1 className="text-[26px] font-bold text-[#0D1428] mb-1.5">
          A pool that{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            reads your credentials
          </span>
        </h1>
        <p className="max-w-[74ch] text-sm text-[#4B5568] mb-6">
          Both pools call the same <b className="font-semibold text-[#0D1428]">EligibilityGate</b> that guards every
          other PassportKit surface — before every swap and every liquidity add. No new eligibility logic, no
          allowlists to maintain: verify, revoke or expire a claim and the pools react instantly. Removing liquidity
          is never gated — funds are never trapped.
        </p>

        {!world && (
          <div className="bg-white border border-[#DDE1EA] rounded-xl p-6">
            <p className="text-sm text-[#4B5568]">
              {error ?? (ready ? 'No demo world yet.' : 'Reading the demo world…')}
            </p>
          </div>
        )}

        {world && (
          <>
            <div className="grid gap-3.5 mb-5 sm:grid-cols-2">
              {POOLS.map((pool) => (
                <PoolCard key={pool.name} meta={pool} row={world.pools[pool.name]} world={world} />
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {world.actors.map((actor) => (
                <MarketsActorCard
                  key={actor.name}
                  actor={actor}
                  world={world}
                  busy={busySet.has(actor.name)}
                  onSwap={swap}
                  onLiquidity={liquidity}
                  onVerify={verify}
                  onRevoke={revoke}
                />
              ))}
            </div>

            {world.local && (
              <div className="flex flex-wrap items-center gap-2 mt-5">
                <span className="mr-1 text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF]">World</span>
                <ActionButton
                  onClick={timewarp}
                  disabled={busySet.has('world')}
                  title="move the chain clock forward — every claim expires"
                >
                  ⏩ Fast-forward 1 year
                </ActionButton>
                <ActionButton
                  onClick={reset}
                  disabled={busySet.has('world')}
                  title="fresh chain, fresh contracts — resets the whole world, Concierge included"
                >
                  ↺ Reset world — both demos
                </ActionButton>
              </div>
            )}

            <div className="mt-5">
              <TxLog
                entries={entries}
                explorer={world.explorer}
                onInspect={setInspecting}
                onClear={() => setEntries([])}
              />
            </div>

            <details className="mt-5 text-sm text-[#4B5568]">
              <summary className="cursor-pointer font-semibold text-[#0D1428]">Demo script (2 minutes)</summary>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
                <li>
                  <b>Rui swaps</b> — an identity with no claims → the pool reverts{' '}
                  <code className="font-mono text-xs">NotCompliant(MISSING_KYC)</code>.
                </li>
                <li>
                  <b>Verify Rui&apos;s KYC</b> (the issuer signs EIP-712, Rui submits it to his own Identity) → he
                  trades the <b>Deal Room pool</b>, and only that one.
                </li>
                <li>
                  <b>Rui tries the Investor pool</b> → <code className="font-mono text-xs">MISSING_ACCREDITED</code>.
                  Verify accreditation → unlocked.
                </li>
                <li>
                  <b>Add liquidity</b>, then <b>revoke KYC</b> (the issuer&apos;s latch) → both pools refuse — but{' '}
                  <b>exit still works</b>. Never trap funds. Verifying again re-opens the latch.
                </li>
                <li>
                  <b>Fast-forward 1 year</b> — claims expire; even the operator gets{' '}
                  <code className="font-mono text-xs">MISSING_KYC</code>. Compliance is live, not a snapshot.
                </li>
                <li>
                  Click any <b>tx hash</b> in the log — decoded events, straight from the chain.
                </li>
              </ol>
            </details>

            <p className="mt-5 font-mono text-[11px] text-[#9CA3AF]">
              gate {short(world.contracts.eligibilityGate)} · issuer {short(world.contracts.claimIssuer)} · factory{' '}
              {short(world.contracts.identityFactory)} · poolManager {short(world.contracts.poolManager)}
            </p>
          </>
        )}
      </div>

      <TxInspector hash={inspecting} explorer={world?.explorer} onClose={() => setInspecting(null)} />
    </div>
  );
}

/// `swap`/`liquidity` answer with one hash, `verify`/`revoke` with a list.
function hashesOf(res: MarketsResult): string[] {
  return res.txHashes ?? (res.txHash ? [res.txHash] : []);
}

// ---------------------------------------------------------------- pieces

function PoolCard({ meta, row, world }: { meta: (typeof POOLS)[number]; row: DemoPoolRow; world: DemoWorldState }) {
  return (
    <article className="flex items-center justify-between gap-3 rounded-xl border border-[#DDE1EA] bg-white px-4 py-3.5">
      <div>
        <h3 className="text-sm font-bold text-[#0D1428]">
          {meta.label} <span className="font-mono text-[11px] font-medium text-[#9CA3AF]">{short(row.hook)}</span>
        </h3>
        <p className="mt-0.5 text-xs text-[#4B5568]">
          {world.pool.token0}/{world.pool.token1} · {feeLabel(world.pool.fee)} · isEligible(identity, policy{' '}
          {row.policyId})
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-[#4B5568]">
          liquidity {row.liquidity} · price {row.price}
        </p>
      </div>
      <StatusPill tone={meta.name === 'deal' ? 'warn' : 'good'}>{meta.policy}</StatusPill>
    </article>
  );
}

function AccessValue({ access }: { access: DemoAccess }) {
  if (access.allowed) return <span className="text-[11px] font-bold text-green-700">✓ allowed</span>;
  return (
    <>
      <span className="text-[11px] font-bold text-red-600">✗</span>
      <ReasonBadge reason={access.reason} />
    </>
  );
}

function ClaimValue({ claim }: { claim: DemoClaim }) {
  const expiry = expiryOf(claim);
  return (
    <>
      <StatusPill tone={toneForStatus(claim.status)}>{claim.status}</StatusPill>
      {expiry && <span className="text-[10px] text-[#9CA3AF]">{expiry}</span>}
    </>
  );
}

const mono = (text: string) => <span className="font-mono text-[11px] text-[#0D1428]">{text}</span>;

function MarketsActorCard({
  actor,
  world,
  busy,
  onSwap,
  onLiquidity,
  onVerify,
  onRevoke,
}: {
  actor: DemoActorState;
  world: DemoWorldState;
  busy: boolean;
  onSwap: (actor: string, pool: MarketPool, zeroForOne: boolean, pair: string) => void;
  onLiquidity: (actor: string, pool: MarketPool, direction: 'add' | 'remove') => void;
  onVerify: (actor: string, claim: ClaimName) => void;
  onRevoke: (actor: string, claim?: ClaimName) => void;
}) {
  const { token0, token1 } = world.pool;
  const forward = `${token0}→${token1}`;
  const backward = `${token1}→${token0}`;

  const rows: ActorCardRow[] = [
    { label: 'wallet', value: mono(short(actor.wallet)) },
    { label: `${CLAIM_LABELS.kyc} claim`, value: <ClaimValue claim={actor.claims.kyc} /> },
    { label: `${CLAIM_LABELS.accredited} claim`, value: <ClaimValue claim={actor.claims.accredited} /> },
    { label: 'Deal Room pool', emphasis: true, value: <AccessValue access={actor.access.deal} /> },
    { label: 'Investor pool', emphasis: true, value: <AccessValue access={actor.access.investor} /> },
    {
      label: 'LP position deal / inv',
      value: mono(`${lp(actor.positions.deal)} / ${lp(actor.positions.investor)}`),
    },
    {
      label: `${token0} / ${token1}`,
      value: mono(`${actor.balances[token0] ?? '—'} / ${actor.balances[token1] ?? '—'}`),
    },
  ];

  return (
    <ActorCard
      name={actor.name}
      role={ROLES[actor.name]}
      badge={
        <StatusPill tone={actor.identity ? 'good' : 'neutral'} mono title={actor.identity ?? undefined}>
          {actor.identity ? `identity ${short(actor.identity)}` : 'no identity'}
        </StatusPill>
      }
      rows={rows}
    >
      <div className="flex flex-col gap-2">
        {POOLS.map((pool) => (
          <div key={pool.name} className="flex flex-wrap items-center gap-1.5">
            <span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">
              {pool.short}
            </span>
            <ActionButton
              variant="primary"
              disabled={busy}
              onClick={() => onSwap(actor.name, pool.name, true, forward)}
              title={`${actor.name}: swap 1 ${token0} for ${token1} in the ${pool.label}`}
            >
              Swap {forward}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => onSwap(actor.name, pool.name, false, backward)}
              title={`${actor.name}: swap 1 ${token1} for ${token0} in the ${pool.label}`}
            >
              Swap {backward}
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => onLiquidity(actor.name, pool.name, 'add')}
              title={`${actor.name}: add liquidity to the ${pool.label} — gated`}
            >
              Add 2 LP
            </ActionButton>
            <ActionButton
              disabled={busy}
              onClick={() => onLiquidity(actor.name, pool.name, 'remove')}
              title={`${actor.name}: exit the ${pool.label} — never gated, funds are never trapped`}
            >
              Exit 2 LP
            </ActionButton>
          </div>
        ))}
      </div>

      <div className="mt-3.5 border-t border-dashed border-[#DDE1EA] pt-2.5">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">Issuer controls</p>
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            variant="verify"
            disabled={busy}
            onClick={() => onVerify(actor.name, 'kyc')}
            title={`${actor.name}: sign + submit a KYC claim — and re-open the latch if it was closed`}
          >
            ⚡ Verify KYC
          </ActionButton>
          <ActionButton
            variant="verify"
            disabled={busy}
            onClick={() => onVerify(actor.name, 'accredited')}
            title={`${actor.name}: sign + submit an accreditation claim`}
          >
            ⚡ Verify accreditation
          </ActionButton>
          <ActionButton
            variant="danger"
            disabled={busy}
            onClick={() => onRevoke(actor.name, 'kyc')}
            title={`${actor.name}: close the issuer's latch on KYC`}
          >
            Revoke KYC ⚠
          </ActionButton>
          <ActionButton
            variant="danger"
            disabled={busy}
            onClick={() => onRevoke(actor.name, 'accredited')}
            title={`${actor.name}: close the issuer's latch on accreditation`}
          >
            Revoke accreditation ⚠
          </ActionButton>
          <ActionButton
            variant="danger"
            disabled={busy}
            onClick={() => onRevoke(actor.name)}
            title={`${actor.name}: every topic at once — the whole identity goes dark`}
          >
            Revoke everything ⚠
          </ActionButton>
        </div>
      </div>
    </ActorCard>
  );
}
