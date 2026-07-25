import { ComingSoon } from '@/components/shell/ComingSoon';

export default function MarketsPage() {
  return (
    <ComingSoon
      eyebrow="Compliance-gated liquidity"
      title="Markets"
      description="Two Uniswap v4 pools behind the same EligibilityGate — a deal pool that wants KYC and an investor pool that wants accreditation. Swap, add liquidity, revoke a claim and watch both refuse while the exit stays open."
      note="Coming in the next task — the /api/demo/markets runtime is already live."
    />
  );
}
