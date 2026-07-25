'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { DealRoomLocked } from '@/components/deal-room/DealRoomLocked';
import { DealRoomLimited } from '@/components/deal-room/DealRoomLimited';
import { DealRoomUnlocked } from '@/components/deal-room/DealRoomUnlocked';
import { DealRoomBlocked } from '@/components/deal-room/DealRoomBlocked';
import { getEligibility } from '@/modules/passport/world-id.service';
import type { PassportState } from '@/modules/passport/passport.types';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';
import { shortenAddress } from '@/lib/format';
import { clearAppSession } from '@/modules/wallet/app-session';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function DealRoomPage() {
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<'privy' | 'metamask'>('privy');
  const [passport, setPassport] = useState<PassportState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPassport = useCallback(async (addr: string) => {
    setLoading(true);
    try {
      const eligibility = await getEligibility(addr);
      const kycVerified = eligibility.kyc.status === 'VERIFIED';
      const personhoodVerified = eligibility.personhood.status === 'VERIFIED';
      setPassport({
        walletAddress: addr,
        status: kycVerified && personhoodVerified ? 'GREEN' : kycVerified || personhoodVerified ? 'LIMITED' : 'NONE',
        claims: [
          { claimType: 'KYC_AML_VERIFIED', status: kycVerified ? 'VERIFIED' : 'UNVERIFIED', approved: kycVerified },
          { claimType: 'ACCREDITED_INVESTOR', status: 'UNVERIFIED', approved: false },
        ],
        badges: [],
        transactions: [],
        canAccessDealRoom: eligibility.dealRoom.eligible,
        canAccessInvestorArea: eligibility.investor.eligible,
        canInvest: eligibility.investor.eligible,
      });
    } catch {
      setPassport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleWalletReady = useCallback(
    async (address: string, provider: 'privy' | 'metamask' = 'privy') => {
      setWalletAddress(address);
      setWalletProvider(provider);
      await fetchPassport(address);
    },
    [fetchPassport],
  );

  const handlePrivyWalletReady = useCallback(
    (addr: string) => handleWalletReady(addr, 'privy'),
    [handleWalletReady],
  );
  const handleMetaMaskWalletReady = useCallback(
    (addr: string) => handleWalletReady(addr, 'metamask'),
    [handleWalletReady],
  );

  function handleDisconnect() {
    clearAppSession();
    setWalletAddress(null);
    setPassport(null);
    router.push('/');
  }

  useEffect(() => {
    if (walletAddress && passport?.claims.some((c) => c.status === 'PENDING' || c.status === 'PROCESSING')) {
      const t = setInterval(() => fetchPassport(walletAddress), 3000);
      return () => clearInterval(t);
    }
  }, [walletAddress, passport, fetchPassport]);

  function renderDealRoom() {
    if (!walletAddress) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] text-center px-6">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-2xl font-bold text-white mb-2">Login to continue.</h2>
          <p className="text-[#8FA0C0] mb-6 max-w-sm">
            Login with your email to access this Deal Room.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {HAS_PRIVY ? (
              <PrivyLoginButton onWalletReady={handlePrivyWalletReady} address={null} />
            ) : (
              <ConnectWalletButton onConnect={handleMetaMaskWalletReady} address={null} />
            )}
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[400px] text-[#8FA0C0] text-sm">
          Loading passport...
        </div>
      );
    }

    if (!passport || passport.status === 'NONE') {
      return <DealRoomLocked />;
    }

    if (passport.status === 'RED' || passport.status === 'REVOKED') {
      return <DealRoomBlocked />;
    }

    if (passport.canAccessDealRoom && passport.status === 'GREEN') {
      return <DealRoomUnlocked />;
    }

    if (passport.canAccessDealRoom && passport.status === 'LIMITED') {
      return <DealRoomLimited />;
    }

    return <DealRoomLocked />;
  }

  const dealRoomState = !walletAddress
    ? 'login'
    : loading
      ? 'loading'
      : !passport || passport.status === 'NONE'
        ? 'locked'
        : passport.status === 'RED' || passport.status === 'REVOKED'
          ? 'blocked'
          : passport.canAccessDealRoom && passport.status === 'GREEN'
            ? 'unlocked'
            : passport.canAccessDealRoom && passport.status === 'LIMITED'
              ? 'limited'
              : 'locked';

  return (
    <div className="min-h-screen bg-[#0B1220]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-700/70 bg-[#0B1220]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-xs font-bold text-white shadow-lg shadow-blue-950/30">
              <span>PK</span>
            </div>
            <span><span className="block text-sm font-bold text-white">{PRODUCT_NAME}</span><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Secure deal room</span></span>
          </Link>
          <div className="flex items-center gap-3">
            {walletAddress && (
              <span className="text-xs font-mono text-[#8FA0C0]">{shortenAddress(walletAddress)}</span>
            )}
            {!walletAddress && (
              HAS_PRIVY
                ? <PrivyLoginButton onWalletReady={handlePrivyWalletReady} address={null} />
                : <ConnectWalletButton onConnect={handleMetaMaskWalletReady} address={null} />
            )}
            <Link
              href="/passport"
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-blue-400 hover:text-white"
            >
              ← Passport
            </Link>
          </div>
        </div>
      </header>

      {/* Passport status bar */}
      {passport && walletAddress && (
        <div className="border-b border-slate-800 bg-[#101A2E]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <span className="text-[10px] font-bold tracking-[0.16em] uppercase text-slate-400">
              Passport Status
            </span>
            <span
              className={`text-xs font-bold ${
                passport.status === 'GREEN'
                  ? 'text-emerald-400'
                  : passport.status === 'LIMITED'
                  ? 'text-[#4A9EFF]'
                  : passport.status === 'RED'
                  ? 'text-red-400'
                  : 'text-[#8FA0C0]'
              }`}
            >
              {passport.status}
            </span>
            <span className="hidden text-slate-600 sm:inline">·</span>
            <span className="text-[10px] text-slate-400">
              KYC/AML: {passport.claims.find((c) => c.claimType === 'KYC_AML_VERIFIED')?.status ?? 'UNVERIFIED'}
            </span>
            <span className="hidden text-slate-600 sm:inline">·</span>
            <span className="text-[10px] text-slate-400">
              Accredited: {passport.claims.find((c) => c.claimType === 'ACCREDITED_INVESTOR')?.status ?? 'UNVERIFIED'}
            </span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: 'easeOut' }} className="mb-8 max-w-2xl"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-400">Restricted workspace</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Investment documents, protected by eligibility.</h1><p className="mt-3 text-sm leading-6 text-slate-400">Access is evaluated from the current compliance passport before any deal materials are revealed.</p></motion.div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={dealRoomState} initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: 0.32, ease: 'easeOut' }}>
            {renderDealRoom()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
