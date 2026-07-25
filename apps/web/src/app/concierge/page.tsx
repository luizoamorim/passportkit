'use client';

/**
 * `/concierge` — the agent rail: Casa Azul's AI concierge spends the house budget
 * under its OWNERS' credentials, never its own.
 *
 * Same loop as `/markets`: read `GET /api/demo/world`, render, act through
 * `POST /api/demo/concierge`, re-read. What differs is the refusal contract.
 *
 * A TICKET NEVER REPORTS ITS OUTCOME THROUGH `ok`. The chain refusing the agent
 * comes back `{ok:true, ticket:{status:'refused', refusal:{…}}}`, and a swap that
 * landed with the vendor left unpaid comes back `{ok:false, status:'unsettled',
 * ticket}` — money moved, so it is emphatically not a refusal. Every ticket
 * handler therefore branches on `ticket.status`, never on `ok`. The other actions
 * (approve, fund, mandate, KYC) are flat `{ok, txHashes}` like markets.
 *
 * Two strings on this page come from outside the chain — the ticket description
 * typed into the composer and `decision.rationale`, which is LLM output when
 * `DECIDER=openai`. Both are rendered as React children, so React escapes them;
 * there is no `dangerouslySetInnerHTML` anywhere on this route.
 */
import { useCallback, useMemo, useRef, useState } from 'react';

import { ActionButton } from '@/components/demo/ActionButton';
import { ActorCard, type ActorCardRow } from '@/components/demo/ActorCard';
import { ApprovalQueue } from '@/components/demo/ApprovalQueue';
import { ReasonBadge } from '@/components/demo/ReasonBadge';
import { StatusPill } from '@/components/demo/StatusPill';
import { TicketFeed } from '@/components/demo/TicketFeed';
import { TxInspector } from '@/components/demo/TxInspector';
import { TxLog, type TxLogEntry, type TxLogTone } from '@/components/demo/TxLog';
import { WorldEmptyState } from '@/components/demo/WorldEmptyState';
import {
  useDemoWorld,
  type DemoAgent,
  type DemoOwner,
  type DemoTicketRow,
  type DemoWorldState,
} from '@/components/demo/useDemoWorld';

// ---------------------------------------------------------------- vocabulary

const CATEGORIES = ['plumbing', 'electrical', 'cleaning', 'admin', 'jewelry'];

/** The two tickets the demo script leans on: one under the cap, one over it. */
const PRESETS: { label: string; description: string; amount: string; category: string }[] = [
  {
    label: 'Leaky faucet — 120 mUSD (plumbing)',
    description: 'Leaky faucet in the kitchen',
    amount: '120',
    category: 'plumbing',
  },
  {
    label: 'Roof repair — 4500 mUSD (plumbing)',
    description: 'Roof repair after the storm',
    amount: '4500',
    category: 'plumbing',
  },
];

const OWNER_ROLES: Record<string, string> = {
  operator: 'Owner · issuer & simulated CRE',
  ana: 'Owner · co-signer on large spend',
};

// ---------------------------------------------------------------- helpers

const short = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

const mono = (text: string) => <span className="font-mono text-[11px] text-[#0D1428]">{text}</span>;

/** Every concierge answer except a ticket: flat `{ok, txHashes}`, refusals included. */
interface ConciergeResult {
  ok: boolean;
  reason?: string | null;
  message?: string;
  txHashes?: string[];
  approvals?: number;
  executed?: boolean;
}

/** `action:'ticket'` — see the module comment: the outcome lives on `ticket.status`. */
interface TicketResult {
  ok: boolean;
  status?: string;
  message?: string;
  ticket?: DemoTicketRow;
}

interface TicketInput {
  description: string;
  amount: string;
  category: string;
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

export default function ConciergePage() {
  const { world, error, ready, runtimeOff, refresh } = useDemoWorld();
  const [entries, setEntries] = useState<TxLogEntry[]>([]);
  const [busy, setBusy] = useState<string[]>([]);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [description, setDescription] = useState('Leaky faucet in the kitchen');
  const [amount, setAmount] = useState('120');
  const [category, setCategory] = useState('plumbing');
  const counter = useRef(0);

  const push = useCallback(
    (entry: { tone: TxLogTone; message: string; outcome?: string; detail?: string; hashes?: string[] }) => {
      counter.current += 1;
      setEntries((prev) => [{ id: `e${counter.current}`, at: Date.now(), ...entry }, ...prev]);
    },
    [],
  );

  /// One control group at a time: its buttons go disabled for the round trip, and
  /// the world is re-read afterwards whatever happened.
  const act = useCallback(
    async (key: string, run: () => Promise<void>) => {
      setBusy((prev) => (prev.includes(key) ? prev : [...prev, key]));
      try {
        await run();
      } finally {
        setBusy((prev) => prev.filter((name) => name !== key));
        await refresh();
      }
    },
    [refresh],
  );

  const call = useCallback(
    (body: Record<string, unknown>) => postJson<ConciergeResult>('/api/demo/concierge', body),
    [],
  );

  // ------------------------------------------------------------ actions

  const submitTicket = useCallback(
    (input?: TicketInput) =>
      act('ticket', async () => {
        const ticket: TicketInput = input ?? {
          description: description.trim() || 'house ticket',
          amount: amount.trim(),
          category,
        };
        const what = `ticket: ${ticket.description} — ${ticket.amount} mUSD (${ticket.category})`;

        const res = await postJson<TicketResult>('/api/demo/concierge', { action: 'ticket', ...ticket });
        // No record at all means the request itself was bad (or the runtime broke) —
        // the only case on this route where `ok` is the thing to read.
        const t = res.ticket;
        if (!t) {
          push({ tone: 'bad', message: what, outcome: 'not accepted', detail: res.message });
          return;
        }

        const hashes = t.txHashes;
        const rationale = t.decision?.rationale;
        switch (t.status) {
          case 'paid':
            push({ tone: 'good', message: what, outcome: `paid ${t.amount} mUSD`, detail: rationale, hashes });
            break;
          case 'pending-approval':
            push({
              tone: 'good',
              message: what,
              outcome: `proposed payment #${t.paymentId} — needs owner approval`,
              detail: rationale,
              hashes,
            });
            break;
          case 'rejected':
            push({ tone: 'bad', message: what, outcome: 'rejected — no chain call', detail: rationale });
            break;
          case 'refused':
            push({
              tone: 'bad',
              message: what,
              outcome: t.refusal?.reason ?? 'refused',
              detail: t.refusal?.message,
              hashes,
            });
            break;
          case 'unsettled':
            push({
              tone: 'bad',
              message: what,
              outcome: 'swap done, vendor unpaid',
              detail: t.settleError ?? undefined,
              hashes,
            });
            break;
          default:
            push({ tone: 'info', message: what, outcome: t.status, detail: rationale, hashes });
        }
      }),
    [act, amount, category, description, push],
  );

  const preset = useCallback(
    (input: TicketInput) => {
      setDescription(input.description);
      setAmount(input.amount);
      setCategory(input.category);
      // submit the preset's own values — the state above lands a render too late
      submitTicket(input);
    },
    [submitTicket],
  );

  const approve = useCallback(
    (owner: string, id: number) =>
      act(`pay:${id}`, async () => {
        const res = await call({ action: 'approve', owner, id });
        const what = `${owner}: approve payment #${id}`;
        if (res.ok) {
          push({
            tone: 'good',
            message: what,
            outcome: res.executed ? 'threshold met — treasury executed' : `signed (${res.approvals} approval)`,
            hashes: res.txHashes,
          });
        } else {
          push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
        }
      }),
    [act, call, push],
  );

  const ownerKyc = useCallback(
    (owner: string, restore: boolean) =>
      act(`owner:${owner}`, async () => {
        const res = await call({ action: restore ? 'restore-owner-kyc' : 'revoke-owner-kyc', owner });
        const what = `issuer: ${restore ? 'restore' : 'revoke'} ${owner}'s KYC claim`;
        if (res.ok) {
          push({
            tone: 'good',
            message: what,
            outcome: restore ? 'compliant again — the agent is back' : "the agent's standing follows",
            hashes: res.txHashes,
          });
        } else {
          push({ tone: 'bad', message: what, outcome: res.reason ?? 'ERROR', detail: res.message });
        }
      }),
    [act, call, push],
  );

  const worldAction = useCallback(
    (action: string, message: string, outcome: string) =>
      act('world', async () => {
        const res = await call({ action, ...(action === 'fund' ? { amount: '500' } : {}) });
        if (res.ok) push({ tone: 'good', message, outcome, hashes: res.txHashes });
        else push({ tone: 'bad', message, outcome: res.reason ?? 'ERROR', detail: res.message });
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
          push({
            tone: 'good',
            message: 'world: fast-forward',
            outcome: `${res.warpedDays} days — the mandate and the owners' claims expire`,
          });
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
  const anyBusy = busy.length > 0;

  // ------------------------------------------------------------ render

  return (
    <div className="flex-1 bg-[#F0F2F6]">
      <div className="max-w-6xl mx-auto px-6 pt-8 pb-16">
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[#4A9EFF] mb-1">
          Agent rail · Surface #5
        </p>
        <h1 className="text-[26px] font-bold text-[#0D1428] mb-1.5">
          An agent that spends{' '}
          <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
            on your passport
          </span>
        </h1>
        <p className="max-w-[74ch] text-sm text-[#4B5568] mb-6">
          Casa Azul&apos;s concierge holds no passport of its own. Its authority is the owners&apos;: the{' '}
          <b className="font-semibold text-[#0D1428]">HouseTreasury</b> re-checks every owner against the{' '}
          <b className="font-semibold text-[#0D1428]">EligibilityGate</b> on every read, and the{' '}
          <b className="font-semibold text-[#0D1428]">MandateHook</b> refuses the budget pool the moment the mandate
          dies or an owner falls out of compliance. Routine tickets are paid autonomously (CASA → mUSD → x402
          invoice); anything over the per-transaction cap goes to the owners&apos; approval queue.
        </p>

        {!world && <WorldEmptyState error={error} ready={ready} runtimeOff={runtimeOff} />}

        {world && (
          <>
            <HouseHeader world={world} />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <AgentCard agent={world.agent} />
              {world.owners.map((owner) => (
                <OwnerCard
                  key={owner.name}
                  owner={owner}
                  busy={busySet.has(`owner:${owner.name}`)}
                  onKyc={ownerKyc}
                />
              ))}
            </div>

            <section className="bg-white border border-[#DDE1EA] rounded-xl p-5 mt-4">
              <h2 className="text-base font-bold text-[#0D1428]">New ticket</h2>
              <p className="mt-0.5 text-xs text-[#4B5568]">
                A vendor request arrives — the concierge decides: pay, propose, or reject.
              </p>

              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitTicket();
                }}
              >
                <label className="flex flex-1 basis-[220px] flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    Description
                  </span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Leaky faucet in the kitchen"
                    className="rounded-lg border border-[#DDE1EA] bg-white px-2.5 py-2 text-xs font-medium text-[#0D1428] focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
                  />
                </label>
                <label className="flex w-[110px] flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    Amount
                  </span>
                  <input
                    value={amount}
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="120"
                    className="rounded-lg border border-[#DDE1EA] bg-white px-2.5 py-2 font-mono text-xs text-[#0D1428] focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#9CA3AF]">
                    Category
                  </span>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="rounded-lg border border-[#DDE1EA] bg-white px-2.5 py-2 text-xs font-medium text-[#0D1428] focus:outline-none focus:ring-2 focus:ring-[#4A9EFF] focus:border-transparent"
                  >
                    {CATEGORIES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={busySet.has('ticket')}
                  className="rounded-lg border border-transparent bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-45"
                >
                  Submit ticket
                </button>
              </form>

              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {PRESETS.map((item) => (
                  <ActionButton
                    key={item.label}
                    disabled={busySet.has('ticket')}
                    onClick={() => preset(item)}
                    title={`submit "${item.description}" for ${item.amount} mUSD`}
                  >
                    {item.label}
                  </ActionButton>
                ))}
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2 mt-4">
              <TicketFeed tickets={world.tickets} explorer={world.explorer} onInspect={setInspecting} />
              <ApprovalQueue
                payments={world.payments}
                owners={world.owners}
                threshold={world.house.approvalThreshold}
                busy={(id) => busySet.has(`pay:${id}`)}
                onApprove={approve}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-5">
              <span className="mr-1 text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF]">World</span>
              <ActionButton
                onClick={() => worldAction('fund', 'owners: fund the concierge', '500 CASA into the budget')}
                disabled={anyBusy}
                title="top the agent's CASA budget back up"
              >
                ＋ Fund 500 CASA
              </ActionButton>
              <ActionButton
                variant="danger"
                onClick={() =>
                  worldAction('revoke-mandate', 'owner: revoke the mandate', 'the pool will refuse the agent')
                }
                disabled={anyBusy}
                title="one owner, one transaction — the agent loses the budget pool"
              >
                Revoke mandate ⚠
              </ActionButton>
              <ActionButton
                variant="verify"
                onClick={() =>
                  worldAction('grant-mandate', 'owner: grant the mandate', '200 mUSD per tx, 1 year')
                }
                disabled={anyBusy}
                title="re-grant the mandate on the same terms DeployAll set up"
              >
                ⚡ Grant mandate
              </ActionButton>
              {world.local && (
                <>
                  <ActionButton
                    onClick={timewarp}
                    disabled={anyBusy}
                    title="move the chain clock forward — the mandate and every claim expire"
                  >
                    ⏩ Fast-forward 1 year
                  </ActionButton>
                  <ActionButton
                    onClick={reset}
                    disabled={anyBusy}
                    title="fresh chain, fresh contracts — resets the whole world, Markets included"
                  >
                    ↺ Reset world — both demos
                  </ActionButton>
                </>
              )}
            </div>

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
                  <b>Leaky faucet — 120 mUSD</b> → within the cap: the agent swaps CASA→mUSD through the gated pool
                  and settles the plumber&apos;s <code className="font-mono text-xs">402</code> invoice. Two
                  transactions, no human.
                </li>
                <li>
                  <b>Roof repair — 4500 mUSD</b> → over the cap:{' '}
                  <code className="font-mono text-xs">proposePayment</code> with the decision&apos;s{' '}
                  <b>evidence hash</b>. Approve as operator, then as ana → the treasury executes.
                </li>
                <li>
                  <b>A &lsquo;jewelry&rsquo; ticket</b> → rejected before any chain call. The rationale is recorded
                  either way.
                </li>
                <li>
                  <b>Revoke Ana&apos;s KYC</b> → the agent&apos;s standing flips to{' '}
                  <code className="font-mono text-xs">OWNER_NOT_COMPLIANT</code> and the next ticket is refused by
                  the hook. Restore it → the agent is back.
                </li>
                <li>
                  <b>Revoke the mandate</b> → <code className="font-mono text-xs">MANDATE_REVOKED</code>, until an
                  owner re-grants it. The brake is one owner and one transaction.
                </li>
                <li>
                  Click any <b>tx hash</b> — decoded events, straight from the chain.
                </li>
              </ol>
            </details>

            <p className="mt-5 font-mono text-[11px] text-[#9CA3AF]">
              treasury {short(world.contracts.treasury)} · hook {short(world.contracts.mandateHook)} · gate{' '}
              {short(world.contracts.eligibilityGate)} · CASA {short(world.contracts.casa)} · mUSD{' '}
              {short(world.contracts.musd)}
            </p>
          </>
        )}
      </div>

      <TxInspector hash={inspecting} explorer={world?.explorer} onClose={() => setInspecting(null)} />
    </div>
  );
}

// ---------------------------------------------------------------- pieces

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[#DDE1EA] px-3 py-1.5 font-mono text-[11.5px] text-[#4B5568]">
      {label} <b className="font-semibold text-[#0D1428]">{children}</b>
    </span>
  );
}

function HouseHeader({ world }: { world: DemoWorldState }) {
  return (
    <section className="mb-4 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-[#DDE1EA] bg-white px-4 py-3.5">
      <div>
        <h2 className="text-sm font-bold text-[#0D1428]">
          Casa Azul{' '}
          <span className="font-mono text-[11px] font-medium text-[#9CA3AF]" title={world.contracts.treasury}>
            {short(world.contracts.treasury)}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-[#4B5568]">
          {world.owners.length} owners · {world.house.approvalThreshold}-of-{world.owners.length} approvals above the
          cap · budget pool gated by MandateHook {short(world.contracts.mandateHook)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat label="treasury">{world.house.treasuryMusd} mUSD</Stat>
        <Stat label="pool liquidity">
          {world.house.poolLiquidity} · price {world.house.poolPrice}
        </Stat>
        <Stat label="decider">{world.decider}</Stat>
      </div>
    </section>
  );
}

function AgentCard({ agent }: { agent: DemoAgent }) {
  const rows: ActorCardRow[] = [
    { label: 'wallet', value: mono(short(agent.wallet)) },
    {
      label: 'standing',
      emphasis: true,
      value: agent.standing.ok ? (
        <span className="text-[11px] font-bold text-green-700">✓ mandate live · owners compliant</span>
      ) : (
        <ReasonBadge reason={agent.standing.reason} />
      ),
    },
    { label: 'CASA budget', value: mono(agent.casa) },
    { label: 'mUSD held', value: mono(agent.musd) },
    { label: 'per-tx cap', value: mono(`${agent.perTxCap} mUSD`) },
  ];

  return (
    <ActorCard
      name="Concierge"
      role="Autonomous house agent — holds no passport of its own"
      badge={
        <StatusPill tone={agent.standing.ok ? 'good' : 'bad'}>
          {agent.standing.ok ? 'in good standing' : (agent.standing.reason ?? 'no standing')}
        </StatusPill>
      }
      rows={rows}
    />
  );
}

function OwnerCard({
  owner,
  busy,
  onKyc,
}: {
  owner: DemoOwner;
  busy: boolean;
  onKyc: (owner: string, restore: boolean) => void;
}) {
  const rows: ActorCardRow[] = [
    { label: 'wallet', value: mono(short(owner.wallet)) },
    {
      label: 'EligibilityGate',
      emphasis: true,
      value: owner.compliant ? (
        <span className="text-[11px] font-bold text-green-700">✓ compliant</span>
      ) : (
        <ReasonBadge reason="NOT_COMPLIANT" message="the issuer's latch is closed on this owner's KYC claim" />
      ),
    },
  ];

  return (
    <ActorCard
      name={owner.name}
      role={OWNER_ROLES[owner.name] ?? 'Owner'}
      badge={<StatusPill tone={owner.compliant ? 'good' : 'bad'}>{owner.compliant ? 'compliant' : 'not compliant'}</StatusPill>}
      rows={rows}
    >
      <div className="flex flex-wrap gap-1.5">
        {owner.compliant ? (
          <ActionButton
            variant="danger"
            disabled={busy}
            onClick={() => onKyc(owner.name, false)}
            title={`close the issuer's latch on ${owner.name}'s KYC — the agent loses BOTH rails`}
          >
            Revoke KYC ⚠
          </ActionButton>
        ) : (
          <ActionButton
            variant="verify"
            disabled={busy}
            onClick={() => onKyc(owner.name, true)}
            title={`re-open the latch on ${owner.name}'s KYC — the agent is authorised again`}
          >
            ⚡ Restore KYC
          </ActionButton>
        )}
      </div>
    </ActorCard>
  );
}
