'use client';

/**
 * The tx inspector drawer: a receipt with every log decoded to a named event on
 * a labelled contract, straight from `GET /api/demo/tx/<hash>`.
 *
 * This is what turns "the demo says it was refused" into "the chain says it was
 * refused" — so it stays one click from every hash in the log.
 *
 * Event names, contract labels and argument values all come off the chain: they
 * are rendered as text, never as HTML.
 */
import { useEffect, useState } from 'react';

import { explorerTxUrl } from './TxLog';

interface InspectorLog {
  contract: string;
  name: string;
  args?: Record<string, string>;
  topic?: string;
}

interface InspectorTx {
  ok: boolean;
  hash?: string;
  status?: string;
  blockNumber?: string;
  timestamp?: number;
  from?: string;
  to?: string | null;
  contract?: string | null;
  gasUsed?: string;
  logs?: InspectorLog[];
  message?: string;
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-xs text-[#9CA3AF]">{label}</dt>
      <dd className="font-mono text-[11px] text-[#0D1428] break-all">{children}</dd>
    </>
  );
}

export function TxInspector({
  hash,
  explorer,
  onClose,
}: {
  /** the tx to show; null keeps the drawer closed */
  hash: string | null;
  explorer?: string | null;
  onClose: () => void;
}) {
  const [tx, setTx] = useState<InspectorTx | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    setTx(null);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/demo/tx/${hash}`, { cache: 'no-store' });
        const body = (await res.json()) as InspectorTx;
        if (cancelled) return;
        if (!body.ok) setError(body.message ?? 'transaction not found');
        else setTx(body);
      } catch {
        if (!cancelled) setError('could not read the receipt');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hash]);

  useEffect(() => {
    if (!hash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hash, onClose]);

  if (!hash) return null;

  const url = explorerTxUrl(explorer, hash);
  const logs = tx?.logs ?? [];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[#0D1428]/30"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Transaction inspector"
        className="fixed top-0 right-0 z-50 h-screen w-full max-w-[420px] overflow-y-auto border-l border-[#DDE1EA] bg-white p-5 shadow-[-8px_0_30px_rgba(13,20,40,0.12)]"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-bold text-[#0D1428]">Transaction</h2>
          <button
            onClick={onClose}
            aria-label="Close transaction inspector"
            className="text-sm text-[#4B5568] border border-[#DDE1EA] rounded-lg px-2 py-0.5 hover:border-[#4A9EFF] transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="mt-1 font-mono text-[11px] text-[#4B5568] break-all">{hash}</p>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-semibold text-[#4A9EFF] hover:underline"
          >
            open in explorer ↗
          </a>
        )}

        {error && <p className="mt-4 text-sm font-semibold text-red-600">{error}</p>}
        {!error && !tx && <p className="mt-4 text-sm text-[#9CA3AF]">loading…</p>}

        {tx && (
          <>
            <dl className="mt-4 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
              <MetaRow label="status">
                <span className={tx.status === 'success' ? 'font-bold text-green-700' : 'font-bold text-red-600'}>
                  {tx.status}
                </span>
              </MetaRow>
              <MetaRow label="block">
                {tx.blockNumber}
                {tx.timestamp ? ` · ${new Date(tx.timestamp * 1000).toLocaleString()}` : ''}
              </MetaRow>
              <MetaRow label="from">{tx.from}</MetaRow>
              <MetaRow label="to">
                {tx.contract ? `${tx.contract} · ` : ''}
                {tx.to ?? '—'}
              </MetaRow>
              <MetaRow label="gas used">{Number(tx.gasUsed ?? 0).toLocaleString()}</MetaRow>
            </dl>

            <h3 className="mt-5 mb-2 text-xs font-semibold text-[#0D1428]">Events ({logs.length})</h3>
            {logs.length === 0 ? (
              <p className="text-xs text-[#9CA3AF]">no events</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {logs.map((log, i) => (
                  <li key={`${log.name}-${i}`} className="rounded-lg border border-[#DDE1EA] px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-[#0D1428]">{log.name}</span>
                      <span className="text-[11px] font-semibold text-[#4A9EFF]">{log.contract}</span>
                    </div>
                    {log.args ? (
                      Object.entries(log.args).map(([key, value]) => (
                        <div key={key} className="flex justify-between gap-2 py-0.5">
                          <span className="text-[11px] text-[#9CA3AF]">{key}</span>
                          <span className="text-right font-mono text-[10.5px] text-[#0D1428] break-all">
                            {value}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex justify-between gap-2 py-0.5">
                        <span className="text-[11px] text-[#9CA3AF]">topic</span>
                        <span className="text-right font-mono text-[10.5px] text-[#0D1428] break-all">
                          {log.topic ?? ''}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </aside>
    </>
  );
}
