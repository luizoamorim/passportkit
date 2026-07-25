import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createVendorServer } from '../vendor/server.js';
import { settleInvoice } from '../lib/x402.js';

const VENDOR_ADDRESS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // test vendor payout address
const TOKEN_ADDRESS = '0x172076E0166D1F9Cc711C77Adf8488051744980C'; // mUSD (from addresses.json)
const AMOUNT = '1000000000000000000'; // 1 mUSD, 18 decimals, wei string

// Starts createVendorServer on an ephemeral port with the given stubbed
// verifier and waits for it to actually be listening before handing back
// its base URL, so callers never race the bind.
async function startVendor(verify) {
  const server = createVendorServer({
    port: 0,
    vendorAddress: VENDOR_ADDRESS,
    tokenAddress: TOKEN_ADDRESS,
    rpcUrl: 'http://127.0.0.1:8545',
    verify,
  });
  await once(server, 'listening');
  const { port } = server.address();
  return { server, vendorUrl: `http://127.0.0.1:${port}` };
}

test('POST /invoice with no X-PAYMENT header returns a 402 exact-scheme challenge', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const res = await fetch(`${vendorUrl}/invoice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1', amount: AMOUNT }),
  });

  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.x402Version, 1);
  assert.equal(body.accepts[0].scheme, 'exact');
  assert.equal(body.accepts[0].payTo, VENDOR_ADDRESS);
  assert.equal(body.accepts[0].asset, TOKEN_ADDRESS);
});

test('settleInvoice pays via payFn on 402 and reports success once verified', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const calls = [];
  const payFn = async (accept) => {
    calls.push(accept);
    return '0xabc';
  };

  const result = await settleInvoice({ vendorUrl, jobId: 'job-2', amount: AMOUNT, payFn });

  assert.deepEqual(result, { paid: true, txHash: '0xabc' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payTo, VENDOR_ADDRESS);
  assert.equal(calls[0].scheme, 'exact');
});

test('settleInvoice reports unpaid when the vendor cannot verify the payment', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => false);
  t.after(() => server.close());

  const result = await settleInvoice({
    vendorUrl,
    jobId: 'job-3',
    amount: AMOUNT,
    payFn: async () => '0xdead',
  });

  assert.equal(result.paid, false);
});

test('unknown routes return 404 JSON', async (t) => {
  const { server, vendorUrl } = await startVendor(async () => true);
  t.after(() => server.close());

  const res = await fetch(`${vendorUrl}/nope`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('content-type'), 'application/json');
});
