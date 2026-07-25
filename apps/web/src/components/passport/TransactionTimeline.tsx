import type { TransactionItem } from '@/modules/passport/passport.types';
import { formatTxHash } from '@/lib/format';

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? 'https://sepolia.basescan.org';

const CONTRACT_COLORS: Record<string, string> = {
  ClaimRegistry: 'text-[#4A9EFF] bg-[#4A9EFF]/10',
  CompliancePassport: 'text-emerald-300 bg-emerald-400/10',
  AccessGate: 'text-purple-500 bg-purple-50',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-blue-500',
  CONFIRMED: 'text-emerald-300',
  SIMULATED: 'text-[#4A9EFF]',
  FAILED: 'text-red-500',
};

type Props = {
  transactions: TransactionItem[];
};

export function TransactionTimeline({ transactions }: Props) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-3xl bg-[#0D1428] p-6 shadow-xl shadow-slate-900/10">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
          Transaction Timeline
        </p>
        <p className="text-sm leading-6 text-slate-400">No onchain transactions yet. Your wallet will show a claim submission here once it is confirmed.</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-[#0D1428] p-6 shadow-xl shadow-slate-900/10">
      <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-300">
        Transaction Timeline
      </p>
      <div className="space-y-3">
        {transactions.map((tx, i) => (
          <div key={tx.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-[#172040] border border-[#1E2D4D] flex items-center justify-center text-xs text-[#8FA0C0]">
                {i + 1}
              </div>
              {i < transactions.length - 1 && (
                <div className="w-px flex-1 bg-[#1E2D4D] my-1" />
              )}
            </div>
            <div className="bg-[#172040] border border-[#1E2D4D] rounded-xl p-3 flex-1 mb-1">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CONTRACT_COLORS[tx.contractName] ?? 'text-slate-400 bg-slate-100'}`}
                >
                  {tx.contractName}
                </span>
                <span className={`text-[10px] font-semibold ${STATUS_COLORS[tx.status]}`}>
                  {tx.status === 'SIMULATED' ? 'DEMO' : tx.status}
                </span>
              </div>
              <p className="text-sm text-white font-medium">{tx.action}</p>
              {tx.transactionHash && (
                <a
                  href={`${EXPLORER_BASE}/tx/${tx.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#4A9EFF] mt-1 hover:underline block"
                >
                  {formatTxHash(tx.transactionHash)} ↗
                </a>
              )}
              <p className="text-[10px] text-[#8FA0C0] mt-1">
                {new Date(tx.createdAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
