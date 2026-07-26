'use client';

import type { DemoWorld } from './ChainChip';

/**
 * The strip that says out loud what the visitor is looking at. Rendered only
 * when `GET /api/demo/world` answered — a 403 means `DEMO_MODE !== 'true'` and
 * the site is running against the real API, where none of this is true.
 */
export function DemoBanner({ world }: { world: DemoWorld | null }) {
  return (
    <div className="bg-[#0D1428] text-white">
      <div className="max-w-6xl mx-auto px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="w-2 h-2 rounded-full bg-gradient-to-br from-[#4A9EFF] to-[#3DDBD9] shrink-0" aria-hidden />
        <span className="text-[10px] font-semibold tracking-widest uppercase text-[#4A9EFF]">
          Demo Mode
        </span>
        <span className="text-xs text-[#8FA0C0]">
          {world?.local === false
            ? 'Live test network — KYC and accredited claims are labeled mocks.'
            : 'Local anvil world — KYC and accredited claims are labeled mocks, no real funds move.'}
        </span>
      </div>
    </div>
  );
}
