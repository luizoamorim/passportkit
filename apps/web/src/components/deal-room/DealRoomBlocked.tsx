import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomBlocked() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-red-500/20 bg-[#101A2E] px-6 text-center shadow-2xl shadow-black/10">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-400/20 bg-red-500/10 text-3xl">
        🚫
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">{RESOURCE_NAME}</h2>
      <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-red-400">
        Access Denied
      </p>
      <p className="mb-6 max-w-sm text-sm leading-6 text-slate-400">
        Critical compliance checks failed. Access is blocked.
      </p>
      <Link
        href="/passport"
        className="rounded-xl border border-red-400/30 px-5 py-3 text-sm font-bold text-red-200 transition hover:bg-red-500/10"
      >
        View Passport →
      </Link>
    </div>
  );
}
