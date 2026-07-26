'use client';

/**
 * The chain the demo world is running on, as a header chip.
 *
 * Fed by `GET /api/demo/world` — `{chainId, local, warped, now}`. `now` is the
 * CHAIN clock, not wall time, which is the whole point: after a timewarp the
 * date jumps and `warped` goes true, so the header itself tells you the claims
 * you are looking at have expired on purpose.
 *
 * Renders nothing when there is no world (demo runtime off, or still probing).
 */

export type DemoWorld = {
  chainId: number;
  local: boolean;
  warped: boolean;
  /** chain timestamp, seconds */
  now: number;
};

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  31337: 'Anvil',
  11155111: 'Sepolia',
};

function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

/** The chain clock as `YYYY-MM-DD` — the unit the expiry story is told in. */
function chainDate(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

export function ChainChip({ world }: { world: DemoWorld | null }) {
  if (!world) return null;

  return (
    <div className="flex items-center gap-2">
      <span
        className="hidden md:inline-flex items-center gap-2 rounded-full border border-[#DDE1EA] bg-white px-3 py-1.5"
        title={`chain ${world.chainId} · chain clock ${chainDate(world.now)}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${world.local ? 'bg-[#3DDBD9]' : 'bg-[#4A9EFF]'}`}
          aria-hidden
        />
        <span className="text-[11px] font-semibold text-[#0D1428]">{chainName(world.chainId)}</span>
        <span className="text-[10px] font-mono text-[#9CA3AF]">#{world.chainId}</span>
        <span className="text-[#DDE1EA]" aria-hidden>
          ·
        </span>
        <span className="text-[10px] font-mono text-[#4B5568]">{chainDate(world.now)}</span>
      </span>

      {world.warped && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-700"
          title="the chain clock has been moved forward — claims may have expired"
        >
          clock warped
        </span>
      )}
    </div>
  );
}
