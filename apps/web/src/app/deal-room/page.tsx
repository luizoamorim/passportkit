'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, WalletConnectControl } from '@/components/shell/AppShell';
import { DealRoomLocked } from '@/components/deal-room/DealRoomLocked';
import { DealRoomLimited } from '@/components/deal-room/DealRoomLimited';
import { DealRoomUnlocked } from '@/components/deal-room/DealRoomUnlocked';
import { DealRoomBlocked } from '@/components/deal-room/DealRoomBlocked';
import { getPassportState } from '@/modules/passport/passport.service';
import type { PassportState } from '@/modules/passport/passport.types';

export default function DealRoomPage() {
  // The wallet lives in the shell — arriving from /passport you are already connected.
  const { address: walletAddress } = useWallet();
  const [passport, setPassport] = useState<PassportState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPassport = useCallback(async (addr: string) => {
    setLoading(true);
    try {
      const state = await getPassportState(addr);
      setPassport(state);
    } catch {
      setPassport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on connect, clear on disconnect — the shell owns the address now.
  useEffect(() => {
    if (!walletAddress) {
      setPassport(null);
      setLoading(false);
      return;
    }
    fetchPassport(walletAddress);
  }, [walletAddress, fetchPassport]);

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
            <WalletConnectControl />
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

  return (
    <div className="flex-1 bg-[#0D1428]">
      {/* Passport status bar */}
      {passport && walletAddress && (
        <div className="border-b border-[#1E2D4D] bg-[#141E38]">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-4">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-[#8FA0C0]">
              Passport Status
            </span>
            <span
              className={`text-xs font-bold ${
                passport.status === 'GREEN'
                  ? 'text-[#3DDBD9]'
                  : passport.status === 'LIMITED'
                  ? 'text-[#4A9EFF]'
                  : passport.status === 'RED'
                  ? 'text-red-400'
                  : 'text-[#8FA0C0]'
              }`}
            >
              {passport.status}
            </span>
            <span className="text-[#1E2D4D]">·</span>
            <span className="text-[10px] text-[#8FA0C0]">
              KYC/AML: {passport.claims.find((c) => c.claimType === 'KYC_AML_VERIFIED')?.status ?? 'UNVERIFIED'}
            </span>
            <span className="text-[#1E2D4D]">·</span>
            <span className="text-[10px] text-[#8FA0C0]">
              Accredited: {passport.claims.find((c) => c.claimType === 'ACCREDITED_INVESTOR')?.status ?? 'UNVERIFIED'}
            </span>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="max-w-3xl mx-auto px-6 py-12">{renderDealRoom()}</main>
    </div>
  );
}
