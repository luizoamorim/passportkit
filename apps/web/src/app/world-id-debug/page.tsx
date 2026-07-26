'use client';

import { useState } from 'react';
import { IDKitRequestWidget, identityCheck, setDebug, type IDKitDebugReport, type RpContext } from '@worldcoin/idkit';

/**
 * TEMP triage route (remove once the dashboard flow is green). It reproduces the known-good
 * world-id-practice flow inside PassportKit: no Privy, no wallet, no signal, no claim,
 * no eligibility, no demo mode. The only job is to prove whether a World ID proof verifies here.
 */

type RpSignatureResponse = {
  app_id: `app_${string}`;
  action: string;
  environment: 'staging' | 'sandbox';
  rp_context: RpContext;
};

type Status = 'idle' | 'verifying' | 'verified' | 'error';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function WorldIdDebugPage() {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<RpSignatureResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const preset = identityCheck({
    attributes: [
      { type: 'document_type', value: 'passport' },
      { type: 'minimum_age', value: 18 },
    ],
  });

  const start = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorCode(null);
    setRequestId(null);
    setStatus('idle');
    try {
      setDebug(true);
      const response = await fetch(`${API_URL}/world-id/debug/request`, { method: 'POST' });
      if (!response.ok) throw new Error('The backend could not create a verification request.');
      const data = (await response.json()) as RpSignatureResponse;
      if (!data.app_id || !data.rp_context) throw new Error('The backend returned an invalid verification request.');
      setRequest(data);
      setOpen(true);
    } catch (error) {
      console.error('[world-id-debug] unable to start:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Unable to start the identity check.');
      setStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '0 auto', padding: 32 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700 }}>World ID debug — Identity Check</h1>
      <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6 }}>
        Isolated triage route. No Privy, no wallet, no signal, no claim. Use the World ID Simulator.
      </p>

      <button
        onClick={start}
        disabled={isLoading}
        style={{ marginTop: 20, padding: '12px 18px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 0, background: isLoading ? '#cbd5e1' : '#2563eb', color: '#fff', cursor: isLoading ? 'not-allowed' : 'pointer' }}
      >
        {isLoading ? 'Preparing verification…' : 'Verify identity'}
      </button>

      {request && (
        <pre style={{ marginTop: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, fontSize: 12, overflowX: 'auto' }}>
{JSON.stringify({ app_id: request.app_id, action: request.action, environment: request.environment, rp_id: request.rp_context.rp_id }, null, 2)}
        </pre>
      )}

      {status === 'verifying' && <p role="status" style={{ marginTop: 16 }}>Verifying identity…</p>}
      {status === 'verified' && <p role="status" style={{ marginTop: 16, color: '#15803d', fontWeight: 700, fontSize: 18 }}>Identity verified</p>}
      {status === 'error' && (
        <div role="alert" style={{ marginTop: 16, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', borderRadius: 10, padding: 12, fontSize: 13 }}>
          <p style={{ fontWeight: 700 }}>Verification failed</p>
          {errorCode && <p>errorCode: <code>{errorCode}</code></p>}
          {requestId && <p>request_id: <code>{requestId}</code></p>}
          {errorMessage && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{errorMessage}</pre>}
        </div>
      )}

      {request && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={request.app_id}
          action={request.action}
          rp_context={request.rp_context}
          allow_legacy_proofs={false}
          environment={request.environment}
          preset={preset}
          handleVerify={async (result) => {
            setStatus('verifying');
            setErrorMessage(null);
            console.info('[world-id-debug] proof received', {
              protocolVersion: (result as unknown as Record<string, unknown>).protocol_version,
              keys: Object.keys(result as unknown as Record<string, unknown>),
            });
            const response = await fetch(`${API_URL}/world-id/debug/verify`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idkitResponse: result }),
            });
            if (!response.ok) {
              const text = await response.text().catch(() => response.statusText);
              setStatus('error');
              setErrorMessage(`API ${response.status}: ${text}`);
              throw new Error(`API ${response.status}: ${text}`);
            }
          }}
          onSuccess={() => {
            setStatus('verified');
            setErrorMessage(null);
          }}
          onError={(code, debugReport?: IDKitDebugReport) => {
            console.error('[world-id-debug] IDKit error', { code, debugReport });
            setStatus('error');
            setErrorCode(code);
            setRequestId(debugReport?.request_id ?? null);
            setErrorMessage((current) => current ?? (code === 'user_rejected' ? 'Identity check was cancelled.' : 'Identity check could not be completed.'));
          }}
        />
      )}
    </main>
  );
}
