import { RESOURCE_NAME } from '@/modules/passport/passport.constants';

export function DealRoomUnlocked() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-5">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="font-bold text-white text-base">Deal Room unlocked.</p>
            <p className="mt-1 text-sm text-slate-300">Your PassportCreds passport is verified and active.</p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-[#101A2E] p-5 shadow-2xl shadow-black/10 sm:p-7">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">
          {RESOURCE_NAME}
        </p>
        <h2 className="mb-6 text-2xl font-bold tracking-tight text-white">Oklahoma Real Estate Portfolio</h2>

        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {['$12.4M', '8.2%', '142'].map((val, i) => (
            <div key={i} className="rounded-2xl border border-slate-800 bg-[#0B1220] p-4 text-center">
              <p className="text-xl font-bold text-emerald-300">{val}</p>
              <p className="mt-1 text-xs text-slate-500">
                {['Portfolio Value', 'Avg. Yield', 'Units'][i]}
              </p>
            </div>
          ))}
        </div>

        <div className="mb-6 space-y-2">
          {['Executive Summary', 'Property Reports', 'Financial Projections', 'Legal Documents'].map(
            (doc) => (
              <div
                key={doc}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-[#0B1220] px-4 py-3"
              >
                <span className="text-sm text-white">{doc}</span>
                <span className="text-xs font-bold text-emerald-300">Unlocked</span>
              </div>
            )
          )}
        </div>

        <div className="border-t border-slate-800 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <button className="flex-1 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-950/30 transition hover:bg-blue-500">
              Invest Now
            </button>
            <button className="flex-1 rounded-xl border border-slate-600 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-emerald-400 hover:text-emerald-200">
              Schedule Call
            </button>
          </div>
          <p className="mt-3 text-center text-xs text-slate-500">
            Demo only — investment flow not built
          </p>
        </div>
      </div>
    </div>
  );
}
