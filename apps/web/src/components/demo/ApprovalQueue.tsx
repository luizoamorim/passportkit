'use client';

/**
 * The other half of the agent rail: anything over the per-transaction cap never
 * reaches the autonomous path — it is proposed to the HouseTreasury and sits here
 * until m-of-n owners sign off, at which point the treasury pays the vendor in mUSD.
 *
 * Every value shown (payment id, vendor, amount, evidence hash, approval count)
 * is read back from the treasury, so the queue is chain state, not a client guess.
 */
import { ActionButton } from './ActionButton';
import { StatusPill } from './StatusPill';
import type { DemoOwner, DemoPayment } from './useDemoWorld';

const short = (value?: string | null) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—');

export function ApprovalQueue({
  payments,
  owners,
  threshold,
  busy,
  onApprove,
}: {
  payments: DemoPayment[];
  owners: DemoOwner[];
  /** how many owner signatures the treasury requires */
  threshold: number;
  /** payment ids currently in flight */
  busy: (id: number) => boolean;
  onApprove: (owner: string, id: number) => void;
}) {
  return (
    <section className="bg-white border border-[#DDE1EA] rounded-xl p-5">
      <h2 className="text-base font-bold text-[#0D1428]">Approval queue</h2>
      <p className="mt-0.5 text-xs text-[#4B5568]">
        Above the cap: {threshold}-of-{owners.length} owners, then the treasury pays mUSD directly.
      </p>

      {payments.length === 0 ? (
        <p className="mt-3 text-xs text-[#9CA3AF]">nothing pending — over-cap tickets land here.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {payments.map((payment) => (
            <article
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#DDE1EA] px-3.5 py-3"
            >
              <div>
                <p className="text-[13px] text-[#0D1428]">
                  <b className="font-semibold">#{payment.id}</b> · {payment.amount} mUSD →{' '}
                  <span className="font-mono text-xs" title={payment.vendor}>
                    {short(payment.vendor)}
                  </span>
                </p>
                <p className="mt-0.5 font-mono text-[10.5px] text-[#9CA3AF]">
                  <span title={payment.evidenceHash}>evidence {short(payment.evidenceHash)}</span> ·{' '}
                  {payment.approvals}/{threshold} approvals
                </p>
              </div>

              {payment.executed ? (
                <StatusPill tone="good">executed</StatusPill>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {owners.map((owner) => (
                    <ActionButton
                      key={owner.name}
                      disabled={busy(payment.id)}
                      onClick={() => onApprove(owner.name, payment.id)}
                      title={`${owner.name} signs off on payment #${payment.id} — the last signature also executes it`}
                    >
                      Approve as {owner.name}
                    </ActionButton>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
