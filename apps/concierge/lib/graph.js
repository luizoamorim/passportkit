import { readFileSync } from 'node:fs';
import path from 'node:path';

// GraphQL access to the PassportKit subgraph (see subgraph/ + docs/specs/graph-spec.md).
// The query builders are pure functions — unit-tested against recorded fixtures —
// while makeGraphClient talks to the LIVE gateway. The fixture client exists only
// for tests and the clearly-labeled "Simulate" demo fallback; the judged flow is live.

const CLAIM_FIELDS = `
  id
  topicName
  topic
  expiresAt
  status
  addedAt
  issuer { id }
  identity {
    id
    wallet
    policyStatuses { eligible reason policy { id topicNames } }
    agents(where: { active: true }) { id agentWallet score }
  }`;

// "Which passports/claims expire in the next N days?"
export function expiringClaimsQuery(days, nowSec) {
  const now = Math.floor(nowSec);
  const until = now + days * 86400;
  return {
    operation: 'ExpiringClaims',
    query: `query ExpiringClaims($now: BigInt!, $until: BigInt!) {
  claims(
    where: { status: ACTIVE, expiresAt_gt: $now, expiresAt_lte: $until }
    orderBy: expiresAt
    orderDirection: asc
    first: 200
  ) {${CLAIM_FIELDS}
  }
  policies(first: 20) { id topics topicNames }
}`,
    variables: { now: String(now), until: String(until) },
  };
}

// "What is the blast radius if issuer X is revoked?" — every ACTIVE claim is
// fetched (bounded) so the assembly can tell topics covered ONLY by X apart
// from topics another trusted issuer also covers for the same identity.
export function blastRadiusQuery(issuer) {
  return {
    operation: 'BlastRadius',
    query: `query BlastRadius($issuer: Bytes!) {
  issuerTrusts(where: { issuer: $issuer, trusted: true }) { topic topicName }
  allTrust: issuerTrusts(where: { trusted: true }) { topic issuer { id } }
  claims(where: { status: ACTIVE }, first: 1000) {${CLAIM_FIELDS}
  }
  policies(first: 20) { id topics topicNames }
  tenants(first: 20) { id policyId }
}`,
    variables: { issuer: issuer.toLowerCase() },
  };
}

// "Full audit trail for wallet 0x…" — claims, latch flips, agent links, gated
// transfers and the indexed history of the gate's own answers, time-ordered.
export function auditTrailQuery(wallet) {
  const w = wallet.toLowerCase();
  return {
    operation: 'AuditTrail',
    query: `query AuditTrail($wallet: Bytes!) {
  wallet(id: $wallet) {
    id
    isAgent
    identity {
      id
      wallet
      createdAt
      createdTx
      claims { id topicName status expiresAt addedAt updatedAt issuer { id } }
      latches { topicName revoked updatedAt }
      claimEvents(orderBy: timestamp, orderDirection: asc, first: 500) {
        kind topicName issuer txHash block timestamp
      }
      snapshots(orderBy: timestamp, orderDirection: asc, first: 500) {
        policy { id } eligible reason trigger txHash timestamp
      }
      agents { agentWallet active score linkedAt unlinkedAt }
      subnames { label parentNode }
    }
  }
  agentEvents(where: { agentWallet: $wallet }, orderBy: timestamp, orderDirection: asc, first: 200) {
    kind personIdentity { id } score txHash timestamp
  }
  transfersOut: tokenTransfers(where: { from: $wallet }, orderBy: timestamp, orderDirection: asc, first: 200) {
    to value isBurn txHash timestamp
  }
  transfersIn: tokenTransfers(where: { to: $wallet }, orderBy: timestamp, orderDirection: asc, first: 200) {
    from value isMint txHash timestamp
  }
}`,
    variables: { wallet: w },
  };
}

// Live gateway client. `url` is the Subgraph Studio dev URL or the gateway URL
// (https://gateway.thegraph.com/api/subgraphs/id/… with GRAPH_API_KEY as bearer).
export function makeGraphClient({ url, apiKey, timeoutMs = 15000 }) {
  return {
    kind: 'live',
    url,
    async run({ query, variables }) {
      const headers = { 'content-type': 'application/json' };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`subgraph request failed: ${res.status}`);
      const body = await res.json();
      if (body.errors?.length) throw new Error(`subgraph errors: ${body.errors.map((e) => e.message).join('; ')}`);
      if (!body.data) throw new Error('subgraph response has no data');
      return body.data;
    },
  };
}

// Recorded-fixture client — tests + the labeled "Simulate" button ONLY. It
// resolves by GraphQL operation name so the exact same builders run against it.
export function makeFixtureClient(dir) {
  return {
    kind: 'fixture',
    url: 'recorded fixtures (NOT live)',
    async run({ query }) {
      const name = /query\s+(\w+)/.exec(query)?.[1];
      if (!name) throw new Error('fixture client: query has no operation name');
      const file = path.join(dir, `${name}.json`);
      return JSON.parse(readFileSync(file, 'utf8')).data;
    },
  };
}
