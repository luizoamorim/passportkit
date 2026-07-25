'use client';

/**
 * What `/markets` and `/concierge` show instead of a world.
 *
 * The landing page links to both routes unconditionally — the four steps are
 * the story, and dropping two of them because a server flag is unset would
 * leave a visitor reading half a sentence. The nav hides them because a nav is
 * a list of what works right now; the story is not. So the front door stays
 * open and the room behind it explains itself: the demo runtime is off, and
 * `make demo` is how you turn it on.
 *
 * Any other failure (runtime up, chain unreachable, world never deployed) keeps
 * the plain message — `make demo` would not be the fix.
 */

export function WorldEmptyState({
  error,
  ready,
  runtimeOff,
}: {
  error: string | null;
  ready: boolean;
  runtimeOff: boolean;
}) {
  if (runtimeOff) {
    return (
      <div className="rounded-xl border border-[#DDE1EA] bg-white p-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-[#4A9EFF]">
          Demo runtime is off
        </p>
        <p className="max-w-[68ch] text-sm text-[#4B5568]">
          This page is driven entirely by a local anvil chain, so it only runs on a machine that has one. The
          server answered <span className="font-mono text-xs text-[#0D1428]">403</span> because{' '}
          <span className="font-mono text-xs text-[#0D1428]">DEMO_MODE</span> is not set — deliberately, since
          turning it on lets anyone who can reach the server sign with the demo actors&apos; keys.
        </p>
        <p className="mt-4 text-xs font-semibold uppercase tracking-widest text-[#9CA3AF]">Run it locally</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-[#0D1428] px-4 py-3 font-mono text-xs text-[#8FA0C0]">
          git clone … &amp;&amp; npm install{'\n'}make demo
        </pre>
        <p className="mt-3 text-xs text-[#4B5568]">
          That starts anvil, deploys the one demo world and serves this site on{' '}
          <span className="font-mono text-[#0D1428]">:3003</span> with the runtime on.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#DDE1EA] bg-white p-6">
      <p className="text-sm text-[#4B5568]">{error ?? (ready ? 'No demo world yet.' : 'Reading the demo world…')}</p>
    </div>
  );
}
