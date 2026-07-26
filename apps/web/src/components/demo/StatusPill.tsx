/**
 * The one status chip the demo pages use — claim states, standing, ticket
 * outcomes. Tone is explicit so a caller can say what it means; `toneForStatus`
 * maps the vocabularies the demo runtime already speaks (`VERIFIED`, `REVOKED`,
 * `pending-approval`, …) onto it for the common case.
 */

export type PillTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE_STYLES: Record<PillTone, string> = {
  neutral: 'bg-[#EEF0F4] text-[#9CA3AF] border-[#DDE1EA]',
  good: 'bg-green-50 text-green-700 border-green-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  bad: 'bg-red-50 text-red-600 border-red-200',
  info: 'bg-cyan-50 text-[#4A9EFF] border-cyan-200',
};

const GOOD = ['VERIFIED', 'GREEN', 'OK', 'ALLOWED', 'PAID', 'EXECUTED', 'COMPLIANT'];
const WARN = ['LIMITED', 'EXPIRED', 'PENDING', 'PENDING-APPROVAL', 'IN_PROGRESS', 'PROCESSING'];
const BAD = ['REVOKED', 'FAILED', 'RED', 'REFUSED', 'UNSETTLED', 'BLOCKED', 'REJECTED'];

/** Maps a runtime status string onto a tone; anything unknown reads as neutral. */
export function toneForStatus(status: string | null | undefined): PillTone {
  const key = (status ?? '').toUpperCase();
  if (GOOD.includes(key)) return 'good';
  if (WARN.includes(key)) return 'warn';
  if (BAD.includes(key)) return 'bad';
  return 'neutral';
}

export function StatusPill({
  children,
  tone = 'neutral',
  title,
  mono = false,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  title?: string;
  /** address-like content reads better in the mono face */
  mono?: boolean;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${
        mono ? 'font-mono normal-case tracking-normal' : ''
      } ${TONE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}
