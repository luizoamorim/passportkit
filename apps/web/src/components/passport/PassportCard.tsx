import type { PassportStatus, PassportBadge } from '@/modules/passport/passport.types';
import { PRODUCT_NAME, PASSPORT_STATUS_LABELS } from '@/modules/passport/passport.constants';
import { ClaimStatusBadge } from './ClaimStatusBadge';
import { shortenAddress, formatTxHash } from '@/lib/format';

const STATUS_CONFIG: Record<
  PassportStatus,
  { border: string; glow: string; label: string; labelColor: string; copy: string }
> = {
  NONE: {
    border: 'border-[#DDE1EA]',
    glow: '',
    label: 'No Passport',
    labelColor: 'text-[#9CA3AF]',
    copy: 'No Passport yet. Complete verification to establish verified ownership.',
  },
  IN_PROGRESS: {
    border: 'border-blue-200',
    glow: 'shadow-blue-100',
    label: 'In Progress',
    labelColor: 'text-blue-500',
    copy: 'Eligibility verification is in progress. Please wait.',
  },
  LIMITED: {
    border: 'border-amber-300',
    glow: 'shadow-amber-100',
    label: 'Limited',
    labelColor: 'text-amber-500',
    copy: 'Passport issued with limited eligibility. Some required claims are still missing.',
  },
  GREEN: {
    border: 'border-emerald-200',
    glow: 'shadow-emerald-100',
    label: 'Full Access',
    labelColor: 'text-emerald-700',
    copy: 'Passport GREEN. All required claims are verified.',
  },
  RED: {
    border: 'border-red-300',
    glow: 'shadow-red-100',
    label: 'Blocked',
    labelColor: 'text-red-500',
    copy: 'Passport RED. The Access Gate blocks protected actions for this owner.',
  },
  REVOKED: {
    border: 'border-red-300',
    glow: 'shadow-red-100',
    label: 'Revoked',
    labelColor: 'text-red-600',
    copy: 'This Passport has been revoked.',
  },
  EXPIRED: {
    border: 'border-amber-200',
    glow: 'shadow-amber-100',
    label: 'Expired',
    labelColor: 'text-amber-500',
    copy: 'This Passport has expired. Please re-verify.',
  },
};

type Props = {
  walletAddress: string;
  status: PassportStatus;
  badges: PassportBadge[];
  passportTokenId?: string | null;
  passportTxHash?: string | null;
};

export function PassportCard({ walletAddress, status, badges, passportTokenId, passportTxHash }: Props) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div
      className={`h-full rounded-3xl border bg-white p-6 shadow-sm sm:p-7 ${cfg.border} ${cfg.glow}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-600">
            {PRODUCT_NAME}
          </p>
          <h2 className="text-xl font-bold tracking-tight text-[#0D1428]">
            Compliance{' '}
            <span className="bg-gradient-to-r from-[#4A9EFF] to-[#3DDBD9] bg-clip-text text-transparent">
              Passport
            </span>
          </h2>
        </div>
        {/* No badge before a Passport exists — the empty state already reads as "not yet". */}
        {status !== 'NONE' && (
          <div className={`rounded-full border border-current/10 bg-current/10 px-3 py-1 text-xs font-bold ${cfg.labelColor}`}>
            <span className={cfg.labelColor}>{cfg.label}</span>
          </div>
        )}
      </div>

      <div className="mb-5 rounded-2xl bg-slate-50 px-4 py-3">
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
          Wallet
        </p>
        <p className="font-mono text-sm font-medium text-slate-700">{shortenAddress(walletAddress)}</p>
      </div>

      <p className="mb-5 text-sm leading-6 text-slate-600">{cfg.copy}</p>

      {badges.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-2">
            Badges
          </p>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge, index) => (
              <div key={`${badge.claimType}-${badge.label}-${index}`} className="flex items-center gap-1.5">
                <span className="text-xs text-[#4B5568] font-medium">{badge.label}</span>
                <ClaimStatusBadge status={badge.status} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {passportTokenId && (
        <div className="mb-2">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            Token ID
          </p>
          <p className="font-mono text-xs text-[#4B5568]">#{passportTokenId}</p>
        </div>
      )}

      {passportTxHash && (
        <div>
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[#9CA3AF] mb-1">
            Passport Tx
          </p>
          <p className="font-mono text-xs text-[#4A9EFF]">{formatTxHash(passportTxHash)}</p>
        </div>
      )}
    </div>
  );
}
