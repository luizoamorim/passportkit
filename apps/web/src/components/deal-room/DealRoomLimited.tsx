import Link from 'next/link';
import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomLimited() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔓</span>
          <div>
            <p className="font-bold text-white text-base">Limited access granted.</p>
            <p className="mt-1 text-sm leading-6 text-slate-300">
              Investor actions remain disabled until Accredited Investor verification is complete.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-[#101A2E] p-5 shadow-2xl shadow-black/10 sm:p-7">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">
          {RESOURCE_NAME}
        </p>
        <h2 className="mb-6 text-2xl font-bold tracking-tight text-white">Oklahoma Real Estate Portfolio</h2>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {['$12.4M', '8.2%', '142'].map((val, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-[#0B1220] p-4 text-center">
              <p className="text-xl font-bold text-blue-300">{val}</p>
              <p className="mt-1 text-xs text-slate-500">
                {['Portfolio Value', 'Avg. Yield', 'Units'][i]}
              </p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {['Executive Summary', 'Property Reports', 'Financial Projections'].map((doc) => (
            <div
              key={doc}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#0B1220] px-4 py-3"
            >
              <span className="text-sm text-white">{doc}</span>
              <span className="text-xs font-semibold text-blue-300">Available</span>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-slate-800 pt-5">
          <p className="mb-3 text-xs text-amber-300">Investor actions require an Accredited Investor badge.</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              disabled
              className="flex-1 cursor-not-allowed rounded-xl bg-slate-800 px-4 py-3 text-sm font-bold text-slate-500"
            >
              Invest Now (Locked)
            </button>
            <Link
              href="/passport"
              className="flex-1 rounded-xl border border-blue-400/40 px-4 py-3 text-center text-sm font-bold text-blue-300 transition hover:bg-blue-500/10"
            >
              Complete Verification
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
