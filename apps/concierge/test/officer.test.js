import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixtureClient } from '../lib/graph.js';
import { askOfficer, makeNarrator, parseQuestion } from '../lib/officer.js';

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
