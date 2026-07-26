'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useReducedMotion } from 'motion/react';
import { PrivyLoginButton } from '@/components/wallet/PrivyLoginButton';
import { ConnectWalletButton } from '@/components/wallet/ConnectWalletButton';
import { ComplianceProgressStepper } from '@/components/passport/ComplianceProgressStepper';
import { PassportCard } from '@/components/passport/PassportCard';
import { AccessDecisionBanner } from '@/components/passport/AccessDecisionBanner';
import { TransactionTimeline } from '@/components/passport/TransactionTimeline';
import { WorldIdPersonhoodCard } from '@/components/passport/WorldIdPersonhoodCard';
import { SelfieCheckCard } from '@/components/passport/SelfieCheckCard';
import { createIdentity, getEligibility, type EligibilityState } from '@/modules/passport/world-id.service';
import type { ClaimStatus, PassportStatus, TransactionItem } from '@/modules/passport/passport.types';
import { PRODUCT_NAME } from '@/modules/passport/passport.constants';
import { AGENT_MANDATE, DASHBOARD_COPY, IDENTITY_COPY, OWNER_APPROVAL, REVOCATION } from '@/content/site-content';
import { clearAppSession } from '@/modules/wallet/app-session';

const HAS_PRIVY = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function PassportPage() {
  const reduceMotion = useReducedMotion();
  const router = useRouter();
  const [wallet, setWallet] = useState<string | null>(null);
  const [provider, setProvider] = useState<'privy' | 'metamask'>('metamask');
  const [state, setState] = useState<EligibilityState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [personhoodVerified, setPersonhoodVerified] = useState(false);
  const [selfieCheckVerified, setSelfieCheckVerified] = useState(false);
  const [identityCheckVerified, setIdentityCheckVerified] = useState(false);

  const refresh = useCallback(async (address: string, ensureIdentity = false) => {
    try {
      let next = await getEligibility(address);
      if (ensureIdentity && !next.identity) {
        await createIdentity(address);
        next = await getEligibility(address);
      }
      setState(next); setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load eligibility state.');
      return null;
    }
  }, []);

  const onWalletReady = useCallback(async (address: string, nextProvider: 'privy' | 'metamask') => {
    setWallet(address); setProvider(nextProvider); setPersonhoodVerified(false); setSelfieCheckVerified(false); setIdentityCheckVerified(false); setLoading(true);
    await refresh(address, true); setLoading(false);
  }, [refresh]);

  const handleMetaMaskWalletReady = useCallback(
    (address: string) => onWalletReady(address, 'metamask'),
    [onWalletReady],
  );
  const handlePrivyWalletReady = useCallback(
    (address: string) => onWalletReady(address, 'privy'),
    [onWalletReady],
  );

  const disconnect = () => { clearAppSession(); setWallet(null); setState(null); setError(null); setTransactions([]); setPersonhoodVerified(false); setSelfieCheckVerified(false); setIdentityCheckVerified(false); router.push('/'); };
  const personhoodStatus: ClaimStatus = personhoodVerified || state?.personhood.status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
  const selfieStatus: ClaimStatus = selfieCheckVerified ? 'VERIFIED' : 'UNVERIFIED';
  const kycStatus: ClaimStatus = identityCheckVerified || state?.kyc.status === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED';
  const passportStatus: PassportStatus = personhoodStatus === 'VERIFIED' && kycStatus === 'VERIFIED' ? 'GREEN' : personhoodStatus === 'VERIFIED' || kycStatus === 'VERIFIED' ? 'LIMITED' : 'NONE';

  return <div className="min-h-screen bg-[#F5F7FB] text-[#0D1428]">
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
      <Link href="/" className="group flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0D1428] text-xs font-bold text-white shadow-lg shadow-slate-900/10 transition-transform group-hover:-translate-y-0.5">PK</span>
        <span><span className="block text-sm font-bold tracking-tight">{PRODUCT_NAME}</span><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Owner control panel</span></span>
      </Link>
      {HAS_PRIVY ? <PrivyLoginButton onWalletReady={handlePrivyWalletReady} onDisconnect={disconnect} address={provider === 'privy' ? wallet : null} /> : <ConnectWalletButton onConnect={handleMetaMaskWalletReady} onDisconnect={disconnect} address={wallet} />}
    </div></header>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <motion.section initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="mb-8 overflow-hidden rounded-3xl bg-[#0D1428] px-6 py-8 text-white shadow-xl shadow-slate-900/10 sm:px-9 sm:py-10">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-blue-200"><span className="h-1.5 w-1.5 rounded-full bg-blue-300" />{DASHBOARD_COPY.eyebrow}</div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{DASHBOARD_COPY.title}</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300 sm:text-base">{DASHBOARD_COPY.description}</p>
        </div>
      </motion.section>
      {!wallet && <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, delay: reduceMotion ? 0 : 0.08 }} className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm sm:p-10"><div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-xl">◈</div><p className="text-xl font-bold tracking-tight">Connect your wallet to begin</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Your wallet remains in control. Passport Kit Node only prepares a signed claim after a valid personhood proof.</p><div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-slate-500"><span className="rounded-full bg-slate-100 px-3 py-1.5">Private by design</span><span className="rounded-full bg-slate-100 px-3 py-1.5">User-submitted claims</span><span className="rounded-full bg-slate-100 px-3 py-1.5">No PII onchain</span></div></motion.div>}
      {loading && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-medium text-blue-700">Preparing your identity and eligibility status…</div>}
      {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"><span><span className="font-bold">We could not refresh your passport.</span> {error}</span>{wallet && <button className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-red-700 shadow-sm ring-1 ring-red-200 hover:bg-red-100" onClick={() => refresh(wallet, true)}>Try again</button>}</div>}
      {wallet && state && !loading && <>
        <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="mb-6"><ComplianceProgressStepper walletConnected passportStatus={passportStatus} kycStatus={kycStatus} personhoodStatus={personhoodStatus} /></motion.div>
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Owner identity</p>
        <p className="mb-4 max-w-3xl text-sm leading-6 text-slate-600">{IDENTITY_COPY.summary}</p>
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <div className="xl:col-span-4"><WorldIdPersonhoodCard wallet={wallet} identity={state.identity} status={kycStatus} mode={state.mode} onComplete={async (message, transactionHash) => { setIdentityCheckVerified(true); if (transactionHash) setTransactions((items) => [...items, { id: transactionHash, contractName: 'CompliancePassport', action: 'Identity Check KYC_VERIFIED submitted by wallet', transactionHash, status: 'PENDING', createdAt: new Date().toISOString() }]); await refresh(wallet); }} /></div>
          <div className="xl:col-span-4"><SelfieCheckCard wallet={wallet} identity={state.identity} status={selfieStatus} mode={state.mode} onComplete={async (message, transactionHash) => { setSelfieCheckVerified(true); setPersonhoodVerified(true); if (transactionHash) setTransactions((items) => [...items, { id: transactionHash, contractName: 'CompliancePassport', action: 'Selfie Check PROOF_OF_PERSONHOOD submitted by wallet', transactionHash, status: 'PENDING', createdAt: new Date().toISOString() }]); await refresh(wallet); }} /></div>
          <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, delay: reduceMotion ? 0 : 0.06 }} whileHover={reduceMotion ? undefined : { y: -2 }} className="xl:col-span-2"><PassportCard walletAddress={wallet} status={passportStatus} badges={[{ label: 'Personhood', claimType: 'KYC_AML_VERIFIED', status: personhoodStatus }, { label: 'KYC', claimType: 'KYC_AML_VERIFIED', status: kycStatus }]} /></motion.div>
          <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, delay: reduceMotion ? 0 : 0.12 }} whileHover={reduceMotion ? undefined : { y: -2 }} className="xl:col-span-2"><AccessDecisionBanner passportStatus={passportStatus} canAccessDealRoom={state.dealRoom.eligible} /></motion.div>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-slate-500">Eligibility is refreshed from the current wallet state.</p><motion.button whileHover={reduceMotion ? undefined : { scale: 1.02 }} whileTap={reduceMotion ? undefined : { scale: 0.98 }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700" onClick={() => refresh(wallet)}>Refresh eligibility</motion.button></div>
        <div className="mt-5"><TransactionTimeline transactions={transactions} /></div>

        {/* Agent authority. UI-only preview: no mandate logic, no onchain calls yet. */}
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Agent authority</p>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">Prototype — not connected</span>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold tracking-tight text-[#0D1428]">{AGENT_MANDATE.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{AGENT_MANDATE.description}</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">
                {AGENT_MANDATE.fields.map((field) => (
                  <li key={field} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">{field}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {AGENT_MANDATE.states.map((state) => (
                  <span key={state} className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{state}</span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold tracking-tight text-[#0D1428]">{OWNER_APPROVAL.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{OWNER_APPROVAL.description}</p>
              <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500">No pending approvals. This area is a UI preview; approval requests are not wired to the backend yet.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {OWNER_APPROVAL.actions.map((action) => (
                  <span key={action} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-400">{action}</span>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-bold tracking-tight text-[#0D1428]">{REVOCATION.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{REVOCATION.description}</p>
              <p className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">{REVOCATION.safetyMessage}</p>
              <span className="mt-3 inline-block cursor-not-allowed rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500">{REVOCATION.cta}</span>
            </div>
          </div>
        </section>
      </>}
    </main>
  </div>;
}
