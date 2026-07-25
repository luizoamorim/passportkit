import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureClient } from '../lib/graph.js';
import { askOfficer, assembleAuditTrail, assembleBlastRadius, makeNarrator, parseQuestion } from '../lib/officer.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/fixtures');
const client = makeFixtureClient(FIXTURES);

// the fixture clock — 2026-07-25T00:00:00Z, matches lib/fixtures/*.json
const NOW = 1784937600;
const ISSUER = '0xc1a1000000000000000000000000000000000001';
const ALICE = '0xa11ce00000000000000000000000000000000001';

// ---------------------------------------------------------------- routing

test('parse_question_routes_expiring_with_explicit_days', () => {
  assert.deepEqual(parseQuestion('Which passports expire in the next 14 days?'), { kind: 'expiring', days: 14 });
});

test('parse_question_defaults_expiring_to_30_days', () => {
  assert.deepEqual(parseQuestion('what claims are expiring soon?'), { kind: 'expiring', days: 30 });
});

test('parse_question_routes_blast_radius_with_issuer_address', () => {
  const q = parseQuestion(`What is the blast radius if issuer ${ISSUER} is revoked?`);
  assert.equal(q.kind, 'blast');
  assert.equal(q.issuer, ISSUER);
});

test('parse_question_routes_audit_trail', () => {
  const q = parseQuestion(`Full audit trail for wallet ${ALICE}`);
  assert.equal(q.kind, 'audit');
  assert.equal(q.wallet, ALICE);
});

test('parse_question_treats_bare_address_as_audit', () => {
  assert.equal(parseQuestion(ALICE).kind, 'audit');
});

test('parse_question_rejects_off_topic_questions', () => {
  assert.equal(parseQuestion('what is the weather in lisbon?').kind, 'unknown');
});

// ---------------------------------------------------------------- expiring

test('expiring_answer_counts_claims_and_names_policies_at_risk', async () => {
  const r = await askOfficer('Which claims expire in the next 30 days?', { client, nowSec: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.facts.expiringClaims, 2);
  assert.equal(r.facts.identitiesAffected, 1);
  assert.match(r.answer[0], /KYC_VERIFIED/);
  assert.match(r.answer[0], /policy #1/);
  assert.match(r.answer[0], /policy #2/);
});

test('expiring_answer_flags_agents_inheriting_the_passport', async () => {
  const r = await askOfficer('Which claims expire in the next 30 days?', { client, nowSec: NOW });
  assert.match(r.answer[0], /1 active agent\(s\) inherit/);
});

// ---------------------------------------------------------------- blast radius

test('blast_radius_counts_identities_losing_eligibility', async () => {
  const r = await askOfficer(`What is the blast radius if issuer ${ISSUER} is revoked?`, { client, nowSec: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.facts.identitiesAffected, 2);
  assert.equal(r.facts.identitiesLosingEligibility, 1);
  assert.equal(r.facts.activeClaimsFromIssuer, 3);
});

test('blast_radius_blocks_linked_agents_with_their_person', async () => {
  const r = await askOfficer(`blast radius if issuer ${ISSUER} revoked`, { client, nowSec: NOW });
  assert.equal(r.facts.agentsBlocked, 1);
  assert.match(r.answer.join('\n'), /blocks 1 linked agent/);
});

test('blast_radius_treats_redundant_coverage_as_no_loss', async () => {
  const r = await askOfficer(`blast radius if issuer ${ISSUER} revoked`, { client, nowSec: NOW });
  const bobLine = r.answer.find((l) => l.includes('0xb0b')) ?? r.answer.find((l) => l.includes('no loss'));
  assert.ok(bobLine, 'expected a line about the redundantly-covered identity');
  assert.match(bobLine, /no loss/);
});

test('blast_radius_ignores_expired_claims', async () => {
  // carol's only claim from this issuer expired 5 days before NOW — she must
  // not appear in the blast at all (the gate already refuses her claim today)
  const r = await askOfficer(`blast radius if issuer ${ISSUER} revoked`, { client, nowSec: NOW });
  assert.ok(!r.answer.some((l) => l.includes('0xca40')), 'expired-claim identity leaked into the blast');
  assert.equal(r.facts.identitiesAffected, 2);
  assert.equal(r.facts.activeClaimsFromIssuer, 3);
});

test('blast_radius_does_not_count_expired_coverage_as_redundancy', () => {
  const KYC = '115060095847048098044821322973818454820402841703488225926853443483099350806907';
  const other = '0xc1a1000000000000000000000000000000000002';
  const identity = {
    id: '0x1d00000000000000000000000000000000000001',
    wallet: '0xdddd000000000000000000000000000000000001',
    policyStatuses: [{ eligible: true, reason: 'OK', policy: { id: '1', topicNames: ['KYC_VERIFIED'] } }],
    agents: [],
  };
  const mk = (issuer, expiresAt) => ({
    id: `c-${issuer}`, topicName: 'KYC_VERIFIED', topic: KYC, expiresAt: String(expiresAt),
    status: 'ACTIVE', addedAt: '0', issuer: { id: issuer }, identity,
  });
  const r = assembleBlastRadius(
    {
      issuerTrusts: [{ topic: KYC, topicName: 'KYC_VERIFIED' }],
      allTrust: [
        { topic: KYC, issuer: { id: ISSUER } },
        { topic: KYC, issuer: { id: other } },
      ],
      // the other issuer's claim EXPIRED — it is not redundancy
      claims: [mk(ISSUER, NOW + 100 * 86400), mk(other, NOW - 86400)],
      policies: [{ id: '1', topics: [KYC], topicNames: ['KYC_VERIFIED'] }],
      tenants: [],
    },
    { issuer: ISSUER, nowSec: NOW },
  );
  assert.equal(r.facts.identitiesLosingEligibility, 1);
  assert.ok(!r.lines.join('\n').includes('no loss'));
});

test('blast_radius_names_enforcement_surfaces', async () => {
  const r = await askOfficer(`blast radius if issuer ${ISSUER} revoked`, { client, nowSec: NOW });
  const joined = r.answer.join('\n');
  assert.match(joined, /Deal Room/);
  assert.match(joined, /GatedERC20/);
  assert.match(joined, /ENS tenant/);
});

// ---------------------------------------------------------------- audit trail

test('audit_trail_orders_events_chronologically', async () => {
  const r = await askOfficer(`Full audit trail for wallet ${ALICE}`, { client, nowSec: NOW });
  assert.equal(r.ok, true);
  const stamps = r.answer.map((l) => l.slice(0, 20));
  assert.deepEqual(stamps, [...stamps].sort());
  assert.ok(r.answer.length >= 10);
});

test('audit_trail_shows_the_latch_flip_and_gate_refusal', async () => {
  const r = await askOfficer(`Full audit trail for wallet ${ALICE}`, { client, nowSec: NOW });
  const joined = r.answer.join('\n');
  assert.match(joined, /REVOKED by issuer \(latch ON\)/);
  assert.match(joined, /REFUSED \(MISSING_KYC\)/);
  assert.match(joined, /latch OFF/);
});

test('audit_trail_includes_agent_events_for_the_person_wallet', async () => {
  const r = await askOfficer(`Full audit trail for wallet ${ALICE}`, { client, nowSec: NOW });
  const joined = r.answer.join('\n');
  assert.match(joined, /AGENT LINKED 0xa9e7…0001/);
  assert.match(joined, /AGENT SCORE_SET 0xa9e7…0001 score=87/);
  assert.equal(r.facts.agentEvents, 2);
});

test('audit_trail_keeps_transfers_for_identityless_wallets', () => {
  const bot = '0xa9e7000000000000000000000000000000000001';
  const r = assembleAuditTrail(
    {
      wallet: { id: bot, isAgent: false, identity: null },
      agentEvents: [
        { id: 'ae-9', kind: 'UNLINKED', agentWallet: bot, score: null, txHash: '0xaa', timestamp: '1784900000' },
      ],
      transfersOut: [{ to: '0xbb', value: '1000000000000000000', isBurn: false, txHash: '0xcc', timestamp: '1784800000' }],
      transfersIn: [],
    },
    { wallet: bot },
  );
  assert.equal(r.facts.events, 2);
  assert.match(r.lines[0], /TOKEN transfer/);
  assert.match(r.lines[1], /AGENT UNLINKED/);
  assert.match(r.summary, /No identity is currently linked/);
});

test('audit_trail_does_not_duplicate_agent_events_for_agent_wallets', () => {
  const bot = '0xa9e7000000000000000000000000000000000001';
  const ev = { id: 'ae-1', kind: 'LINKED', agentWallet: bot, score: null, txHash: '0xaa', timestamp: '1784900000' };
  const r = assembleAuditTrail(
    {
      // an agent wallet resolves to the person's identity, whose agentEvents
      // include this same event — it must appear once, not twice
      wallet: {
        id: bot,
        isAgent: true,
        identity: {
          id: '0x1d0a11ce000000000000000000000000000a0001',
          wallet: '0xa11ce00000000000000000000000000000000001',
          createdAt: '1784700000',
          createdTx: '0x01',
          claims: [],
          claimEvents: [],
          snapshots: [],
          agents: [],
          agentEvents: [ev],
          subnames: [],
        },
      },
      agentEvents: [ev],
      transfersOut: [],
      transfersIn: [],
    },
    { wallet: bot },
  );
  assert.equal(r.facts.agentEvents, 1);
  assert.equal(r.lines.filter((l) => l.includes('AGENT LINKED')).length, 1);
});

test('audit_trail_reports_current_claims_in_summary', async () => {
  const r = await askOfficer(`Full audit trail for wallet ${ALICE}`, { client, nowSec: NOW });
  assert.match(r.summary, /KYC_VERIFIED=ACTIVE/);
  assert.equal(r.facts.subnames[0], 'alice');
});

// ---------------------------------------------------------------- contract of the answer

test('officer_cites_the_query_it_ran', async () => {
  const r = await askOfficer('Which claims expire in the next 7 days?', { client, nowSec: NOW });
  assert.equal(r.citations.length, 1);
  assert.match(r.citations[0].query, /query ExpiringClaims/);
  assert.equal(r.citations[0].variables.now, String(NOW));
  assert.ok(r.citations[0].rows > 0);
  assert.equal(r.source.kind, 'fixture');
});

test('officer_requires_an_address_for_blast_radius', async () => {
  const r = await askOfficer('what is the blast radius if the issuer is revoked?', { client, nowSec: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MISSING_ADDRESS');
});

test('officer_lists_supported_questions_for_unknown_input', async () => {
  const r = await askOfficer('sing me a song', { client, nowSec: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'UNSUPPORTED_QUESTION');
  assert.equal(r.supported.length, 3);
});

test('officer_surfaces_query_failures_without_crashing', async () => {
  const broken = { kind: 'live', url: 'x', run: async () => { throw new Error('gateway down'); } };
  const r = await askOfficer('Which claims expire in the next 7 days?', { client: broken, nowSec: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'QUERY_FAILED');
  assert.match(r.message, /gateway down/);
});

// ---------------------------------------------------------------- narrator

test('mock_narrator_returns_the_template_summary_unchanged', async () => {
  const narrate = makeNarrator('mock');
  assert.equal(await narrate('exactly this', {}), 'exactly this');
});

test('openai_narrator_falls_back_to_template_on_error', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('nope'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const narrate = makeNarrator('openai', { baseUrl: 'https://api.example.com/v1', model: 'm' });
  assert.equal(await narrate('template stands', { facts: {} }), 'template stands');
});

test('openai_narrator_uses_a_wellformed_reply', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '{"summary":"rephrased"}' } }] }),
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const narrate = makeNarrator('openai', { baseUrl: 'https://api.example.com/v1', model: 'm' });
  assert.equal(await narrate('template', { facts: {} }), 'rephrased');
});
