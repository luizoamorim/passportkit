import { formatEther } from 'viem';
import { auditTrailQuery, blastRadiusQuery, expiringClaimsQuery } from './graph.js';

// Compliance officer: a closed set of question types, each answered by a
// deterministic subgraph query + assembly. Every answer carries the query it
// ran and the rows it used — the citation IS the interface. An optional
// narrator (mock default, OpenAI-compatible like deciders.js) may rephrase the
// summary, but it never invents facts: the lines/facts stay deterministic.

export const SUPPORTED_QUESTIONS = [
  'Which passports/claims expire in the next N days?',
  'What is the blast radius if issuer 0x… is revoked?',
  'Full audit trail for wallet 0x…',
];

// Enforcement surfaces per policy — architecture facts from DeployPassportKit.s.sol
// (policy #1 = Deal Room + GatedERC20 transfer gate, policy #2 = Investor tier).
// ENS tenants are added dynamically from the subgraph's Tenant entities.
const POLICY_SURFACES = {
  1: ['Deal Room (gated app)', 'GatedERC20 transfers'],
  2: ['Investor tier (Deal Room invest)'],
};

const ADDR_RE = /0x[0-9a-fA-F]{40}/;

export function parseQuestion(text) {
  const t = String(text ?? '').toLowerCase();
  const addr = String(text ?? '').match(ADDR_RE);
  const address = addr ? addr[0].toLowerCase() : null;

  if (/issuer/.test(t) && /(blast|revok|remov|distrust|compromis)/.test(t)) {
    return { kind: 'blast', issuer: address };
  }
  if (/(audit|trail|history|activity|happened)/.test(t)) {
    return { kind: 'audit', wallet: address };
  }
  if (/expir/.test(t)) {
    const m = t.match(/(\d+)\s*(?:days?|d\b)/);
    return { kind: 'expiring', days: m ? Number(m[1]) : 30 };
  }
  if (address) return { kind: 'audit', wallet: address }; // bare address → audit trail
  return { kind: 'unknown' };
}

const iso = (sec) => new Date(Number(sec) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const inDays = (sec, nowSec) => Math.max(0, Math.floor((Number(sec) - nowSec) / 86400));

function policiesByTopic(policies) {
  const map = new Map(); // topic (string) -> [{id, topicNames}]
  for (const p of policies ?? []) {
    for (const topic of p.topics ?? []) {
      if (!map.has(topic)) map.set(topic, []);
      map.get(topic).push(p);
    }
  }
  return map;
}

// ---------------------------------------------------------------- expiring

export function assembleExpiring(data, { days, nowSec }) {
  const claims = data.claims ?? [];
  const byTopic = policiesByTopic(data.policies);
  const identities = new Set();
  const lines = [];

  for (const c of claims) {
    identities.add(c.identity.id);
    const atRiskPolicies = byTopic.get(c.topic) ?? [];
    const risk = atRiskPolicies.length
      ? ` — at risk: ${atRiskPolicies.map((p) => `policy #${p.id}`).join(', ')}`
      : '';
    const agents = (c.identity.agents ?? []).length;
    const agentNote = agents ? ` — ${agents} active agent(s) inherit this passport` : '';
    lines.push(
      `wallet ${short(c.identity.wallet)} (identity ${short(c.identity.id)}): ${c.topicName} expires ` +
        `${iso(c.expiresAt)} (in ${inDays(c.expiresAt, nowSec)}d)${risk}${agentNote}`,
    );
  }

  const facts = { days, expiringClaims: claims.length, identitiesAffected: identities.size };
  const summary = claims.length
    ? `${claims.length} active claim(s) on ${identities.size} passport(s) expire within ${days} days; ` +
      `earliest: ${iso(claims[0].expiresAt)}.`
    : `No active claims expire within ${days} days.`;
  return {
    interpretation: `Claims with status ACTIVE and expiresAt within the next ${days} days`,
    summary,
    lines,
    facts,
  };
}

// ---------------------------------------------------------------- blast radius

export function assembleBlastRadius(data, { issuer, nowSec }) {
  const x = issuer.toLowerCase();
  const trustedTopics = (data.issuerTrusts ?? []).map((t) => t.topicName);
  // No event fires when a claim expires, so its indexed status stays ACTIVE —
  // but the gate's isClaimValid already refuses it. Filter expiry here (the
  // one place both the live path and the fixtures go through) or an expired
  // claim counts as reliance, and worse, as redundant coverage ("no loss").
  const now = Math.floor(nowSec ?? Date.now() / 1000);
  const claims = (data.claims ?? []).filter(
    (c) => !c.expiresAt || c.expiresAt === '0' || Number(c.expiresAt) > now,
  );
  const tenants = data.tenants ?? [];

  // topic -> other trusted issuers (redundancy a claim could fall back to)
  const otherTrusted = new Map();
  for (const t of data.allTrust ?? []) {
    if (t.issuer.id.toLowerCase() === x) continue;
    if (!otherTrusted.has(t.topic)) otherTrusted.set(t.topic, new Set());
    otherTrusted.get(t.topic).add(t.issuer.id.toLowerCase());
  }

  // identity -> reliance on X, and identity+topic coverage by other issuers
  const relies = new Map(); // identityId -> { identity, topics: Map(topic -> {topicName, redundant}) }
  const covered = new Set(); // `${identityId}|${topic}` held from another still-trusted issuer
  for (const c of claims) {
    const cIssuer = c.issuer.id.toLowerCase();
    if (cIssuer !== x && otherTrusted.get(c.topic)?.has(cIssuer)) {
      covered.add(`${c.identity.id}|${c.topic}`);
    }
  }
  for (const c of claims) {
    if (c.issuer.id.toLowerCase() !== x) continue;
    if (!relies.has(c.identity.id)) relies.set(c.identity.id, { identity: c.identity, topics: new Map() });
    relies.get(c.identity.id).topics.set(c.topic, {
      topicName: c.topicName,
      redundant: covered.has(`${c.identity.id}|${c.topic}`),
    });
  }

  const lines = [];
  let identitiesLosing = 0;
  let agentsBlocked = 0;
  const lostPolicyCounts = new Map(); // policyId -> count

  for (const { identity, topics } of relies.values()) {
    const lostTopics = [...topics.entries()].filter(([, v]) => !v.redundant);
    const redundant = [...topics.values()].filter((v) => v.redundant);
    if (!lostTopics.length) {
      lines.push(
        `wallet ${short(identity.wallet)}: all ${redundant.length} claim(s) from this issuer are also covered ` +
          `by another trusted issuer — no loss`,
      );
      continue;
    }
    const lostTopicSet = new Set(lostTopics.map(([topic]) => topic));
    const lostPolicies = (data.policies ?? []).filter((p) => (p.topics ?? []).some((t) => lostTopicSet.has(t)));
    const nowIneligible = lostPolicies.filter((p) => {
      const st = (identity.policyStatuses ?? []).find((s) => s.policy.id === p.id);
      return !st || st.eligible; // unknown status counted as a loss (fail-closed)
    });
    for (const p of nowIneligible) lostPolicyCounts.set(p.id, (lostPolicyCounts.get(p.id) ?? 0) + 1);
    if (nowIneligible.length) identitiesLosing += 1;

    const agents = (identity.agents ?? []).filter((a) => a);
    agentsBlocked += nowIneligible.length ? agents.length : 0;

    const surfaces = nowIneligible.flatMap((p) => {
      const s = [...(POLICY_SURFACES[p.id] ?? [])];
      for (const t of tenants) if (String(t.policyId) === p.id) s.push(`ENS tenant ${short(t.id)} (records flip)`);
      return s.map((name) => `${name} [policy #${p.id}]`);
    });

    lines.push(
      `wallet ${short(identity.wallet)}: loses ${lostTopics.map(([, v]) => v.topicName).join(' + ')} → ` +
        (nowIneligible.length
          ? `refused on: ${surfaces.join(', ') || nowIneligible.map((p) => `policy #${p.id}`).join(', ')}`
          : 'already ineligible for the affected policies') +
        (agents.length && nowIneligible.length ? ` — blocks ${agents.length} linked agent(s) with it` : ''),
    );
  }

  const facts = {
    issuer: x,
    trustedForTopics: trustedTopics,
    activeClaimsFromIssuer: [...relies.values()].reduce((n, r) => n + r.topics.size, 0),
    identitiesAffected: relies.size,
    identitiesLosingEligibility: identitiesLosing,
    agentsBlocked,
    policiesHit: [...lostPolicyCounts.entries()].map(([id, count]) => ({ policyId: id, identities: count })),
  };
  const summary = relies.size
    ? `Revoking issuer ${short(x)} cuts ${facts.activeClaimsFromIssuer} active claim(s) on ` +
      `${relies.size} passport(s): ${identitiesLosing} lose eligibility` +
      (agentsBlocked ? `, taking ${agentsBlocked} linked agent(s) down with them` : '') +
      `. One latch, every surface refuses at once.`
    : `Issuer ${short(x)} backs no active claims — revoking it changes nothing today.`;
  return {
    interpretation: `Active claims signed by issuer ${x}, cross-checked for coverage by other trusted issuers, mapped to policies and enforcement surfaces`,
    summary,
    lines,
    facts,
  };
}

// ---------------------------------------------------------------- audit trail

export function assembleAuditTrail(data, { wallet }) {
  const w = data.wallet;
  const id = w ? w.identity : null;
  const events = [];
  const push = (timestamp, line, txHash) =>
    events.push({ timestamp: Number(timestamp), line, txHash: txHash ?? null });

  if (id) {
    push(id.createdAt, `IDENTITY created for wallet ${short(id.wallet)} → ${short(id.id)}`, id.createdTx);
    for (const e of id.claimEvents ?? []) {
      const verb =
        e.kind === 'ADDED' ? 'claim ADDED' :
        e.kind === 'REMOVED' ? 'claim REMOVED by holder' :
        e.kind === 'LATCH_ON' ? 'REVOKED by issuer (latch ON)' : 'latch OFF (issuer re-opened)';
      push(e.timestamp, `CLAIM ${e.topicName}: ${verb}`, e.txHash);
    }
    for (const s of id.snapshots ?? []) {
      push(
        s.timestamp,
        `GATE policy #${s.policy.id}: ${s.eligible ? 'ELIGIBLE' : `REFUSED (${s.reason})`} — after ${s.trigger}`,
        s.txHash,
      );
    }
  }

  // Agent events flow in from BOTH sides — this wallet acting as an agent
  // (top-level) and the identity's own agents (derived field). For an agent
  // wallet the two sets overlap, so dedupe by event id.
  const agentEvents = new Map();
  const agentSources = [...((id && id.agentEvents) ?? []), ...(data.agentEvents ?? [])];
  for (const e of agentSources) {
    agentEvents.set(e.id ?? `${e.kind}-${e.txHash}-${e.timestamp}`, e);
  }
  for (const e of agentEvents.values()) {
    const who = e.agentWallet ? ` ${short(e.agentWallet)}` : '';
    push(e.timestamp, `AGENT ${e.kind}${who}${e.score != null ? ` score=${e.score}` : ''}`, e.txHash);
  }

  // Transfers are keyed by wallet, not identity — an unlinked agent (or any
  // identity-less wallet) still has its indexed transfer history.
  for (const t of data.transfersOut ?? []) {
    push(t.timestamp, `TOKEN ${t.isBurn ? 'burn (free exit)' : `transfer ${formatEther(BigInt(t.value))} → ${short(t.to)}`}`, t.txHash);
  }
  for (const t of data.transfersIn ?? []) {
    push(t.timestamp, `TOKEN ${t.isMint ? `mint ${formatEther(BigInt(t.value))}` : `received ${formatEther(BigInt(t.value))} ← ${short(t.from)}`}`, t.txHash);
  }
  events.sort((a, b) => a.timestamp - b.timestamp);

  const lines = events.map((e) => `${iso(e.timestamp)} · ${e.line}${e.txHash ? ` (tx ${short(e.txHash)})` : ''}`);
  const claimsNow = id
    ? (id.claims ?? []).map((c) => `${c.topicName}=${c.status}`).join(', ') || 'none'
    : 'none (no identity linked)';
  const facts = {
    wallet,
    isAgent: w ? w.isAgent : false,
    identity: id ? id.id : null,
    events: events.length,
    claimEvents: id ? (id.claimEvents ?? []).length : 0,
    gateChecks: id ? (id.snapshots ?? []).length : 0,
    agentEvents: agentEvents.size,
    transfers: (data.transfersOut ?? []).length + (data.transfersIn ?? []).length,
    currentClaims: claimsNow,
    subnames: id ? (id.subnames ?? []).map((s) => s.label) : [],
  };
  const summary = id
    ? `${events.length} indexed event(s) for wallet ${short(wallet)}${w.isAgent ? " (an AGENT wallet — inherits its person's passport)" : ''}. ` +
      `Current claims: ${claimsNow}.`
    : `No identity is currently linked to wallet ${short(wallet)} — ` +
      (events.length
        ? `${events.length} indexed event(s) on record (transfers / agent history).`
        : 'nothing on record.');
  return {
    interpretation: `Every indexed event touching wallet ${wallet}: identity, claims, latches, gate outcomes, agent links, gated transfers`,
    summary,
    lines,
    facts,
  };
}

// ---------------------------------------------------------------- narrator

const NARRATOR_SYSTEM_PROMPT = [
  'You are a compliance officer summarizing query results from an identity/compliance subgraph.',
  'You are given a deterministic template summary plus the exact facts. Rephrase the summary in',
  'one or two crisp sentences. NEVER add numbers, addresses or claims not present in the facts.',
  'Respond with ONLY minified JSON: {"summary":"string"}',
].join('\n');

// Mirrors makeDecider: mock = the deterministic template IS the narration;
// openai = optional rephrasing that falls back to the template on any error.
export function makeNarrator(kind, opts = {}) {
  if (kind === 'mock') return async (summary) => summary;
  if (kind === 'openai') {
    return async (summary, assembled) => {
      try {
        const headers = { 'content-type': 'application/json' };
        if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
        const res = await fetch(`${opts.baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: NARRATOR_SYSTEM_PROMPT },
              { role: 'user', content: JSON.stringify({ summary, facts: assembled.facts }) },
            ],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
        });
        if (!res.ok) throw new Error(`narrator request failed: ${res.status}`);
        const body = await res.json();
        const parsed = JSON.parse(body?.choices?.[0]?.message?.content ?? '');
        if (typeof parsed.summary !== 'string' || !parsed.summary.length) throw new Error('bad narrator reply');
        return parsed.summary;
      } catch {
        return summary; // template narration is always valid
      }
    };
  }
  throw new Error('unknown narrator: ' + kind);
}

// ---------------------------------------------------------------- entrypoint

function countRows(data) {
  let n = 0;
  for (const v of Object.values(data ?? {})) {
    if (Array.isArray(v)) n += v.length;
    else if (v && typeof v === 'object') n += 1;
  }
  return n;
}

export async function askOfficer(question, { client, nowSec = Date.now() / 1000, narrator = null }) {
  const intent = parseQuestion(question);
  if (intent.kind === 'unknown') {
    return { ok: false, reason: 'UNSUPPORTED_QUESTION', message: 'I answer these:', supported: SUPPORTED_QUESTIONS };
  }
  if (intent.kind === 'blast' && !intent.issuer) {
    return { ok: false, reason: 'MISSING_ADDRESS', message: 'Name the issuer address (0x…) to compute the blast radius.' };
  }
  if (intent.kind === 'audit' && !intent.wallet) {
    return { ok: false, reason: 'MISSING_ADDRESS', message: 'Name the wallet address (0x…) for the audit trail.' };
  }

  const q =
    intent.kind === 'expiring' ? expiringClaimsQuery(intent.days, nowSec)
    : intent.kind === 'blast' ? blastRadiusQuery(intent.issuer)
    : auditTrailQuery(intent.wallet);

  const t0 = Date.now();
  let data;
  try {
    data = await client.run(q);
  } catch (err) {
    return { ok: false, reason: 'QUERY_FAILED', message: String(err?.message ?? err).slice(0, 300) };
  }
  const latencyMs = Date.now() - t0;

  const assembled =
    intent.kind === 'expiring' ? assembleExpiring(data, { days: intent.days, nowSec })
    : intent.kind === 'blast' ? assembleBlastRadius(data, { issuer: intent.issuer, nowSec })
    : assembleAuditTrail(data, { wallet: intent.wallet });

  const summary = narrator ? await narrator(assembled.summary, assembled) : assembled.summary;

  return {
    ok: true,
    question,
    intent: intent.kind,
    interpretation: assembled.interpretation,
    source: { kind: client.kind, url: client.url, latencyMs },
    summary,
    answer: assembled.lines,
    facts: assembled.facts,
    citations: [{ label: q.operation, query: q.query, variables: q.variables, rows: countRows(data), data }],
  };
}
