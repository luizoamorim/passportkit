import type { ClaimStatus } from '@/modules/passport/passport.types';
import { CLAIM_STATUS_LABELS } from '@/modules/passport/passport.constants';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

const STATUS_STYLES: Record<ClaimStatus, string> = {
  UNVERIFIED: 'bg-slate-100 text-slate-500 border-slate-200',
  PENDING: 'bg-blue-50 text-blue-500 border-blue-200',
  PROCESSING: 'bg-cyan-50 text-[#4A9EFF] border-cyan-200',
  VERIFIED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  FAILED: 'bg-red-50 text-red-500 border-red-200',
  EXPIRED: 'bg-amber-50 text-amber-500 border-amber-200',
  REVOKED: 'bg-red-50 text-red-600 border-red-200',
};

const STATUS_DOTS: Record<ClaimStatus, string> = {
  UNVERIFIED: 'bg-slate-400',
  PENDING: 'bg-blue-500',
  PROCESSING: 'bg-[#4A9EFF]',
  VERIFIED: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  EXPIRED: 'bg-amber-500',
  REVOKED: 'bg-red-600',
};

type Props = {
  status: ClaimStatus;
  size?: 'sm' | 'md';
};

export function ClaimStatusBadge({ status, size = 'md' }: Props) {
  const reduceMotion = useReducedMotion();
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={status}
        initial={reduceMotion ? false : { opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${textSize} ${STATUS_STYLES[status]}`}
      >
        <motion.span
          animate={reduceMotion ? { opacity: 1, scale: 1 } : status === 'PROCESSING' ? { opacity: [0.45, 1, 0.45] } : { scale: status === 'VERIFIED' ? [0.8, 1.15, 1] : 1 }}
          transition={status === 'PROCESSING' && !reduceMotion ? { duration: 1.4, repeat: Infinity } : { duration: 0.25 }}
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOTS[status]}`}
        />
        {CLAIM_STATUS_LABELS[status]}
      </motion.span>
    </AnimatePresence>
  );
}
