'use client';

/**
 * The on-chain log: every action the demo took, newest first, with each tx hash
 * clickable straight into the inspector.
 *
 * Entries are STRUCTURED, not HTML strings — the standalone demos built log
 * lines with `innerHTML` and interpolated chain data into them. Everything here
 * (reason codes, messages, hashes) comes off the chain or out of the runtime, so
 * it is rendered as text and React escapes it.
 */

export type TxLogTone = 'good' | 'bad' | 'info';

export interface TxLogEntry {
  id: string;
  /** wall-clock ms — when the action was taken */
  at: number;
  tone: TxLogTone;
  /** "rui swap on deal pool" */
  message: string;
  /** the outcome, e.g. "filled (-1.00 PROP, +0.99 mUSD)" or "MISSING_KYC" */
  outcome?: string;
  /** the fuller refusal / error line */
  detail?: string;
  hashes?: string[];
}

const TONE_STYLES: Record<TxLogTone, string> = {
  good: 'text-[#4ADE80]',
  bad: 'text-[#F87171]',
  info: 'text-[#C7D0DE]',
};

const TONE_MARKS: Record<TxLogTone, string> = { good: '✓', bad: '✗', info: '·' };

const short = (hash: string) => `${hash.slice(0, 6)}…${hash.slice(-4)}`;

const clockTime = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Only ever link out to a real http(s) explorer — the URL comes from the env. */
function explorerTxUrl(explorer: string | null | undefined, hash: string): string | null {
  if (!explorer || !/^https?:\/\//i.test(explorer)) return null;
  return `${explorer.replace(/\/$/, '')}/tx/${hash}`;
}

export function TxLog({
  entries,
  explorer,
  onInspect,
  onClear,
  title = 'On-chain log',
  emptyHint = 'waiting for the first action… (click any tx hash to inspect it)',
}: {
  entries: TxLogEntry[];
  explorer?: string | null;
  onInspect: (hash: string) => void;
  onClear?: () => void;
  title?: string;
  emptyHint?: string;
}) {
  return (
    <section className="bg-white border border-[#DDE1EA] rounded-xl p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold text-[#0D1428]">{title}</h2>
        {onClear && entries.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs font-semibold text-[#4B5568] border border-[#DDE1EA] rounded-lg px-2.5 py-1 hover:border-[#4A9EFF] transition-colors"
          >
            clear
          </button>
        )}
      </div>

      <div className="mt-3 max-h-[280px] overflow-y-auto rounded-lg bg-[#0D1428] px-3.5 py-3 font-mono text-xs leading-relaxed">
        {entries.length === 0 ? (
          <p className="text-[#5C6A82]">{emptyHint}</p>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li key={entry.id} className="py-0.5 text-[#C7D0DE] break-words">
                <span className="text-[#5C6A82]">{clockTime(entry.at)}</span> {entry.message}{' '}
                <span className={TONE_STYLES[entry.tone]}>
                  {TONE_MARKS[entry.tone]} {entry.outcome}
                </span>
                {entry.detail && <span className="text-[#8FA0C0]"> — {entry.detail}</span>}
                {entry.hashes?.map((hash) => {
                  const url = explorerTxUrl(explorer, hash);
                  return (
                    <span key={hash}>
                      {' '}
                      <button
                        onClick={() => onInspect(hash)}
                        title="inspect this transaction"
                        className="text-[#7EB6FF] underline decoration-dotted underline-offset-2 hover:text-white"
                      >
                        {short(hash)}
                      </button>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="open in explorer"
                          className="ml-1 text-[#7EB6FF] no-underline hover:text-white"
                        >
                          ↗
                        </a>
                      )}
                    </span>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export { explorerTxUrl };
