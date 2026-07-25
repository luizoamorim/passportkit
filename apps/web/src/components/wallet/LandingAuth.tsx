'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLogin, useLoginWithEmail, usePrivy, useWallets } from '@privy-io/react-auth';
import { markAppAuthenticated } from '@/modules/wallet/app-session';
import { setupPrivyWallet } from '@/modules/wallet/wallet.service';

function PrivyLandingAuth() {
  const router = useRouter();
  const { authenticated, ready, user } = usePrivy();
  const { wallets } = useWallets();
  const { sendCode, loginWithCode, state } = useLoginWithEmail({
    onError: () => undefined,
  });
  const { login: loginWithWallet } = useLogin({
    onError: () => undefined,
  });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authenticated || !user || wallets.length === 0) return;
    const wallet = wallets.find((item) => item.walletClientType === 'privy') ?? wallets[0];
    if (!wallet) return;
    void (async () => {
      try {
        await setupPrivyWallet(user.id, wallet.address);
      } catch {
        // The dashboard can still demonstrate the real Privy session if local setup is unavailable.
      }
      markAppAuthenticated();
      router.replace('/passport');
    })();
  }, [authenticated, user, wallets, router]);

  async function submitEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await sendCode({ email: email.trim() });
      setPhase('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'We could not send the verification code.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginWithCode({ code: code.trim() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The verification code was not accepted.');
    } finally {
      setSubmitting(false);
    }
  }

  function connectWallet() {
    setError(null);
    // Privy's configured wallet login opens its supported-wallet selector and authenticates via SIWE.
    loginWithWallet({ loginMethods: ['wallet'], walletChainType: 'ethereum-only' });
  }

  const pending = submitting || state.status === 'sending-code' || state.status === 'submitting-code';
  return (
    <div className="mx-auto mt-9 grid max-w-2xl gap-4 text-left sm:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">Email</p>
        <h2 className="mt-2 text-lg font-bold text-slate-950">Continue with email</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">Receive a one-time code through Privy. An embedded wallet is created or recovered after sign-in.</p>
        {phase === 'email' ? <form onSubmit={submitEmail} className="mt-4 space-y-3"><label className="sr-only" htmlFor="email">Email address</label><input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-blue-100 focus:ring-4" /><button disabled={!ready || pending} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">{pending ? 'Sending code…' : 'Send verification code'}</button></form> : <form onSubmit={submitCode} className="mt-4 space-y-3"><label className="text-xs font-medium text-slate-600" htmlFor="code">Code sent to {email}</label><input id="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none ring-blue-100 focus:ring-4" /><button disabled={pending} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-blue-700 disabled:opacity-50">{pending ? 'Verifying…' : 'Verify and continue'}</button><button type="button" onClick={() => setPhase('email')} className="w-full text-xs font-semibold text-slate-500 hover:text-blue-700">Use another email</button></form>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-300">Wallet</p>
        <h2 className="mt-2 text-lg font-bold">Connect your wallet</h2>
        <p className="mt-1 text-sm leading-5 text-slate-300">Connect with any supported wallet.</p>
        <button onClick={connectWallet} disabled={!ready} className="mt-8 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-blue-50 disabled:opacity-50">Choose supported wallet</button>
        <p className="mt-3 text-xs leading-5 text-slate-400">The available options are supplied by your Privy and browser wallet configuration.</p>
      </section>
      {error && <p role="alert" className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function LandingAuth() {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <div className="mx-auto mt-9 grid max-w-2xl gap-4 text-left sm:grid-cols-2"><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-600">Email</p><h2 className="mt-2 text-lg font-bold text-slate-950">Continue with email</h2><button disabled className="mt-6 w-full rounded-xl bg-slate-200 px-4 py-2.5 text-sm font-bold text-slate-500">Privy configuration required</button></section><section className="rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.14em] text-blue-300">Wallet</p><h2 className="mt-2 text-lg font-bold">Connect your wallet</h2><p className="mt-1 text-sm text-slate-300">Connect with any supported wallet.</p><button disabled className="mt-6 w-full rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300">Privy configuration required</button></section><p role="status" className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Add <code>NEXT_PUBLIC_PRIVY_APP_ID</code> to <code>apps/web/.env.local</code> to enable email OTP and the supported-wallet selector locally.</p></div>;
  }
  return <PrivyLandingAuth />;
}
