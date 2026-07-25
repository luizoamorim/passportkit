import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditTrailQuery,
  blastRadiusQuery,
  expiringClaimsQuery,
  makeFixtureClient,
  makeGraphClient,
} from '../lib/graph.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/fixtures');
const ISSUER = '0xC1A1000000000000000000000000000000000001';

test('expiring_claims_query_bounds_the_window', () => {
  const q = expiringClaimsQuery(14, 1784937600);
  assert.equal(q.operation, 'ExpiringClaims');
  assert.equal(q.variables.now, '1784937600');
  assert.equal(q.variables.until, String(1784937600 + 14 * 86400));
  assert.match(q.query, /status: ACTIVE/);
});

test('blast_radius_query_lowercases_the_issuer', () => {
  const q = blastRadiusQuery(ISSUER);
  assert.equal(q.variables.issuer, ISSUER.toLowerCase());
  assert.match(q.query, /issuerTrusts/);
  assert.match(q.query, /allTrust/);
});

test('audit_trail_query_lowercases_the_wallet', () => {
  const q = auditTrailQuery('0xA11CE00000000000000000000000000000000001');
  assert.equal(q.variables.wallet, '0xa11ce00000000000000000000000000000000001');
  assert.match(q.query, /tokenTransfers/);
});

test('fixture_client_resolves_by_operation_name', async () => {
  const client = makeFixtureClient(FIXTURES);
  const data = await client.run(expiringClaimsQuery(30, 1784937600));
  assert.ok(Array.isArray(data.claims));
  assert.equal(client.kind, 'fixture');
});

test('live_client_posts_query_with_bearer_key', async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ data: { claims: [] } }) };
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = makeGraphClient({ url: 'https://gateway.example/api', apiKey: 'key-123' });
  const data = await client.run(expiringClaimsQuery(7, 1784937600));
  assert.deepEqual(data, { claims: [] });
  assert.equal(calls[0].url, 'https://gateway.example/api');
  assert.equal(calls[0].init.headers.authorization, 'Bearer key-123');
  const body = JSON.parse(calls[0].init.body);
  assert.match(body.query, /ExpiringClaims/);
});

test('live_client_throws_on_graphql_errors', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ errors: [{ message: 'boom' }] }),
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const client = makeGraphClient({ url: 'https://gateway.example/api' });
  await assert.rejects(() => client.run(expiringClaimsQuery(7, 0)), /boom/);
});
