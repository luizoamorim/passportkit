import type { PassportStatus } from '@/modules/passport/passport.types';
import Link from 'next/link';

type Props = {
  passportStatus: PassportStatus;
  canAccessDealRoom: boolean;
};

export function AccessDecisionBanner({ passportStatus, canAccessDealRoom }: Props) {
  if (passportStatus === 'GREEN') {
    return (
      <div className="h-full rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-base font-bold text-emerald-950">Access granted</p>
            <p className="mt-1 text-sm leading-6 text-emerald-800">Your Passport is verified and active. The Access Gate allows protected actions.</p>
            <Link
              href="/deal-room"
              className="mt-4 inline-block rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-800"
            >
              Open gated surface →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (passportStatus === 'LIMITED' && canAccessDealRoom) {
    return (
      <div className="h-full rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🔓</span>
          <div>
            <p className="text-base font-bold text-amber-950">Limited access</p>
            <p className="mt-1 text-sm leading-6 text-amber-900">
              Some protected actions stay blocked until the remaining claims are verified.
            </p>
            <Link
              href="/deal-room"
              className="mt-4 inline-block rounded-xl border border-amber-300 px-4 py-2.5 text-sm font-bold text-amber-900 transition hover:bg-amber-100"
            >
              Open gated surface →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (passportStatus === 'RED' || passportStatus === 'REVOKED') {
    return (
      <div className="h-full rounded-3xl border border-red-200 bg-red-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🚫</span>
          <div>
            <p className="font-bold text-red-600 text-base">Access Denied</p>
            <p className="text-sm text-[#4B5568] mt-0.5">
              Required claims are missing or failed. The Access Gate refuses protected actions.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="h-full rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔒</span>
        <div>
          <p className="text-base font-bold text-[#0D1428]">Access Gate closed</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Complete owner verification to open protected actions.
          </p>
        </div>
      </div>
    </div>
  );
}
