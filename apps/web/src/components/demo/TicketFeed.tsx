'use client';

/**
 * The concierge's ticket feed: every request the agent was handed, newest first,
 * with the decision it made, why it made it, and the evidence hash that commits
 * to both.
 *
 * This is the one surface on the site that renders LLM output — `decision.rationale`
 * is model text when `DECIDER=openai`, and the ticket description is typed by
 * whoever is driving the demo. Both are rendered as React children (escaped), never
 * as HTML, exactly like the chain-derived reason codes next to them.
 */
import { ReasonBadge } from './ReasonBadge';
import { StatusPill, toneForStatus, type PillTone } from './StatusPill';
import { explorerTxUrl } from './TxLog';
import type { DemoTicketRow } from './useDemoWorld';

/// A settled swap with an unpaid vendor is its own outcome, not a refusal — the
/// money already left the agent's wallet, so it must not read as "the chain said no".
const STATUS_LABEL: Record<string, string> = {
  'pending-approval': 'pending approval',
  unsettled: 'unsettled — swap done, vendor unpaid',
};

const STATUS_TONE: Record<string, PillTone> = {
  paid: 'good',
  executed: 'good',
  'pending-approval': 'warn',
  unsettled: 'warn',
  rejected: 'bad',
  refused: 'bad',
};

const short = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

function TxHashes({
  hashes,
  explorer,
  onInspect,
}: {
  hashes: string[];
  explorer?: string | null;
  onInspect: (hash: string) => void;
}) {
  return (
    <>
      {hashes.map((hash) => {
        const url = explorerTxUrl(explorer, hash);
        return (
          <span key={hash} className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => onInspect(hash)}
              title="inspect this transaction"
              className="text-[#4A9EFF] underline decoration-dotted underline-offset-2 hover:text-[#0D1428]"
            >
              {short(hash)}
            </button>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title="open in explorer"
                className="text-[#4A9EFF] no-underline hover:text-[#0D1428]"
              >
                ↗
              </a>
            )}
          </span>
        );
      })}
    </>
  );
}

function Ticket({
  ticket,
  explorer,
  onInspect,
}: {
  ticket: DemoTicketRow;
  explorer?: string | null;
  onInspect: (hash: string) => void;
}) {
  const status = ticket.status || ticket.decision?.action || '—';

  return (
    <article className="rounded-lg border border-[#DDE1EA] px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-[#0D1428] break-words">{ticket.description}</h3>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs font-semibold text-[#0D1428]">{ticket.amount} mUSD</span>
          <StatusPill tone={STATUS_TONE[status] ?? toneForStatus(status)}>
            {STATUS_LABEL[status] ?? status}
          </StatusPill>
        </div>
      </div>

      {ticket.decision && (
        <p className="mt-1.5 text-xs text-[#4B5568] break-words">
          {/* the verdict the decider reached, then the reasoning it gave for it */}
          <b className="font-semibold text-[#0D1428]">{ticket.decision.action}</b> — {ticket.decision.rationale}
          <span className="text-[#9CA3AF]"> · confidence {Number(ticket.decision.confidence).toFixed(2)}</span>
        </p>
      )}

      {ticket.refusal && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#4B5568]">
          <span className="font-semibold text-red-600">
            {ticket.refusal.source === 'treasury' ? 'treasury refused' : 'hook refused'}
          </span>
          <ReasonBadge reason={ticket.refusal.reason} message={ticket.refusal.message} />
          {/* the badge falls back to the message when there is no code — don't print it twice */}
          {ticket.refusal.reason && ticket.refusal.message && (
            <span className="break-words">{ticket.refusal.message}</span>
          )}
        </p>
      )}

      {ticket.settleError && (
        <p className="mt-1.5 font-mono text-[11px] text-amber-700 break-words">
          swap settled, vendor unpaid: {ticket.settleError}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-[#9CA3AF]">
        <span>
          #{ticket.id} · {ticket.category}
        </span>
        <span title={ticket.evidenceHash}>evidence {short(ticket.evidenceHash)}</span>
        {ticket.paymentId != null && <span>payment #{ticket.paymentId}</span>}
        {ticket.txHashes.length > 0 && (
          <TxHashes hashes={ticket.txHashes} explorer={explorer} onInspect={onInspect} />
        )}
      </div>
    </article>
  );
}

export function TicketFeed({
  tickets,
  explorer,
  onInspect,
}: {
  /** newest first — the order `/api/demo/world` already returns */
  tickets: DemoTicketRow[];
  explorer?: string | null;
  onInspect: (hash: string) => void;
}) {
  return (
    <section className="bg-white border border-[#DDE1EA] rounded-xl p-5">
      <h2 className="text-base font-bold text-[#0D1428]">Ticket feed</h2>
      <p className="mt-0.5 text-xs text-[#4B5568]">Every decision, its rationale and its evidence hash.</p>

      {tickets.length === 0 ? (
        <p className="mt-3 text-xs text-[#9CA3AF]">no tickets yet — submit one above, or use a preset.</p>
      ) : (
        <div className="mt-3 flex max-h-[460px] flex-col gap-2.5 overflow-y-auto">
          {tickets.map((ticket) => (
            <Ticket key={ticket.id} ticket={ticket} explorer={explorer} onInspect={onInspect} />
          ))}
        </div>
      )}
    </section>
  );
}
