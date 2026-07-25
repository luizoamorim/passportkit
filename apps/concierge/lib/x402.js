// x402 client: POSTs an invoice to the vendor; if the vendor answers 402
// (payment required), pays via the injected `payFn` (returns a txHash) and
// retries once with the X-PAYMENT header attached. `payFn` is injected so
// callers/tests never need a real chain here.
export async function settleInvoice({ vendorUrl, jobId, amount, payFn }) {
  const body = JSON.stringify({ jobId, amount });

  const first = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });

  if (first.status === 200) {
    return { paid: true, txHash: null };
  }

  const challenge = await first.json();
  const accept = challenge.accepts[0];
  const txHash = await payFn(accept);

  const retry = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-payment': JSON.stringify({ txHash }),
    },
    body,
  });

  return { paid: retry.status === 200, txHash };
}
