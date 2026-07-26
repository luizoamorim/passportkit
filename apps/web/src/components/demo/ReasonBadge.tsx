/**
 * A refusal, rendered as the reason code the chain actually returned:
 * `MISSING_KYC`, `MISSING_ACCREDITED`, `OWNER_NOT_COMPLIANT`, `MANDATE_REVOKED`,
 * `OVER_PER_TX_CAP`, … The code IS the demo — a refusal with no code on screen
 * proves nothing — so it is always shown verbatim, with the fuller message on
 * hover.
 *
 * Reason codes come off the chain, so they are rendered as text (never as HTML).
 */

export function ReasonBadge({
  reason,
  message,
  tone = 'bad',
}: {
  reason?: string | null;
  /** the longer `Refused(0x…, MISSING_KYC)` line, shown on hover */
  message?: string | null;
  tone?: 'bad' | 'warn';
}) {
  const label = reason || message;
  if (!label) return null;

  const styles =
    tone === 'warn'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-red-200 bg-red-50 text-red-600';

  return (
    <span
      title={message ?? undefined}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${styles}`}
    >
      {label}
    </span>
  );
}
