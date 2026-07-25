import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomLocked() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-slate-800 bg-[#101A2E] px-6 text-center shadow-2xl shadow-black/10">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-3xl">
        🔒
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">{RESOURCE_NAME}</h2>
      <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">
        Access Required
      </p>
      <p className="mb-6 max-w-sm text-sm leading-6 text-slate-400">
        This Deal Room requires a valid Compliance Passport. Complete verification to continue.
      </p>
      <Link
        href="/passport"
        className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500"
      >
        Start Compliance Flow →
      </Link>
    </div>
  );
}
