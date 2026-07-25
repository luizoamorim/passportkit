# Spec — Subgraph + Compliance-Officer Agent (The Graph)

> Target: **The Graph "Best AI Use Case"** — an agent reasoning over a **live** Graph data source.
> HARD RULE from the prize sheet: *"mocked or static data does not qualify"* — the judged flow
> must hit the live Graph gateway. Fixtures exist for unit tests ONLY; the demo path queries live.

---

## 0. Locked decisions

- **One subgraph** (`subgraph/` at repo root) on **Ethereum Sepolia**, deployed to **Subgraph Studio**.
  It indexes the claim lifecycle, identity/agent links, revocation latches, policies, issuer trust,
  gated transfers, ENS subnames and agent scores — everything the gate's answer is derived from.
- **The agent is a compliance officer**, not a chatbot: it lives in `apps/concierge` (the existing
  agent layer), answers a closed set of question types with **deterministic query builders**, and
  every answer **cites the GraphQL query + the rows it used**. An LLM never invents data; it only
  gets involved (optional, `DECIDER`-style) to phrase the assembled answer.
- **Eligibility is re-computed at index time**: on every claim, revocation-latch AND issuer-trust
  event the mapping calls `EligibilityGate.isEligible(identity, policyId)` for each known policy
  and stores a snapshot. The subgraph therefore has the *history* of gate outcomes — something no
  surface stores on-chain. Trust flips fan out via `IssuerTrust.claimIds` (mappings cannot scan
  the store, so claims are indexed under their issuer+topic as they land).
- **Addresses come from `contracts/deployments/11155111.json`** (written by `DeployPassportKit.s.sol`).
  `subgraph.yaml` + `src/config.ts` are **generated** by `npm run prepare:sepolia` — no hand-edited
  addresses, consistent with "no hard-coded demo values".
- **Demo resilience:** the `/officer` page has a clearly-labeled **"Simulate (recorded)"** fallback
  for network death mid-presentation. Presentation insurance only — never the judged flow.

---

## 1. Event schema (what we index — from `contracts/src/`, not invented)

| Contract (static data source) | Event | Meaning |
|---|---|---|
| `IdentityFactory` | `IdentityCreated(wallet, identity)` | passport born → **spawns an `Identity` template** |
| `IdentityFactory` | `AgentLinked(agentWallet, personIdentity)` | x402 agent inherits the person's compliance |
| `IdentityFactory` | `AgentUnlinked(agentWallet, personIdentity)` | agent disowned |
| `ClaimIssuer` | `RevocationSet(identity, topic, revoked)` | **the latch** — the money moment |
| `ClaimIssuer` | `SignerSet(signer, ok)` | global signer lever (key compromise) |
| `IssuerRegistry` | `TrustedSet(issuer, topic, ok)` | issuer de/trusted for a topic |
| `EligibilityGate` | `PolicySet(policyId, topics)` | policy = required topics |
| `GatedERC20` | `Transfer(from, to, value)` | movements the gate allowed |
| `ScoreRegistry` | `ScoreSet(agent, score)` | agent reputation |
| `PassportSubnameRegistrar` | `SubnameIssued(parentNode, label, userWallet, identity)` | ENS identity |
| `PassportResolver` | `TenantSet(parentNode, gate, policyId, controller)` | tenant wired |

| Dynamic template (one per user) | Event | Meaning |
|---|---|---|
| `Identity` | `ClaimAdded(claimId, topic, issuer)` | holder submitted an issuer-signed claim |
| `Identity` | `ClaimRevoked(topic, issuer)` | holder voluntarily removed a claim |
| `Identity` | `KeyAdded(key, purpose)` | ERC-734 key |

**Expiry:** `ClaimAdded` does not carry the claim payload; the handler calls
`Identity.getClaim(topic, issuer)` and decodes `data = abi.encode(dataHash, expiresAt, nonce)`
(zero PII — a hash, an expiry, a nonce). That decode is what makes "what expires in N days"
answerable at all.

---

## 2. Entity model

Current-state entities (mutable):

- **`Identity`** — id = identity address; `wallet`, `createdAt`, derived `claims`, `agents`,
  `subnames`, `policyStatuses`.
- **`Wallet`** — id = wallet address; `identity`, `isAgent` (person wallets and agent wallets both
  resolve here — mirrors `identityOfWallet`).
- **`Claim`** — id = `identity-topic-issuer`; `topic`, `topicName` (reverse-keccak of the three
  known topics), `issuer`, `dataHash`, `expiresAt`, `status` (`ACTIVE` / `REMOVED` / `REVOKED`),
  timestamps. `REVOKED` mirrors the issuer latch for that identity+topic.
- **`RevocationLatch`** — id = `identity-topic` on the ClaimIssuer; `revoked`, `updatedAt`.
- **`AgentLink`** — id = agent wallet; `personIdentity`, `active`, `score`, `linkedAt`, `unlinkedAt`.
- **`Issuer`** — id = issuer address; `topics` via **`IssuerTrust`** (id = `issuer-topic`,
  `trusted`, plus `claimIds` — the enumerable index that lets a TrustedSet flip re-snapshot
  every identity holding that issuer's claims).
- **`Policy`** — id = policyId; `topics`, `topicNames`.
- **`Subname`** — id = `parentNode-label`; `label`, `wallet`, `identity`.
- **`PassportPolicyStatus`** — id = `identity-policyId`; latest `eligible` + `reason` from the
  index-time gate call.

Audit-trail entities (immutable, the officer's evidence):

- **`ClaimEvent`** — `ADDED` / `REMOVED` (holder) / `LATCH_ON` / `LATCH_OFF` (issuer), with
  identity, topic, issuer, tx hash, block, timestamp.
- **`AgentEvent`** — `LINKED` / `UNLINKED` / `SCORE_SET`.
- **`TokenTransfer`** — from, to, value, tx, timestamp (mint/burn flagged).
- **`EligibilitySnapshot`** — identity, policy, `eligible`, `reason`, `trigger` (which event caused
  the re-check), tx, timestamp. **This is the history of the gate.**

---

## 3. The three officer questions (minimum, wired end-to-end)

1. **"Which passports/claims expire in the next N days?"**
   → `claims(where: {status: ACTIVE, expiresAt_gt: now, expiresAt_lt: now+N·86400})`
   grouped by identity, joined with the policies each expiring topic participates in.
2. **"What is the blast radius if issuer X is revoked?"**
   → active claims where `issuer = X` (who relies on it, per topic) × policies containing those
   topics × surfaces reading each policy (Deal Room #1, GatedERC20 #1, Investor #2, ENS tenant
   policy) × `AgentLink`s hanging off the affected identities. Answer: *who* loses *what*, *where*
   — including their agents.
3. **"Full audit trail for wallet 0x…"**
   → `Wallet` → identity → `ClaimEvent`s + `AgentEvent`s + `TokenTransfer`s +
   `EligibilitySnapshot`s, merged and time-ordered.

Every answer ships `{question, interpretation, queries[], rows, answer[], citations[]}` — the
queries are shown verbatim on the demo page next to the data they returned.

---

## 4. Runtime architecture

```
/officer page (concierge server :4190)
   → POST /api/officer/ask {question}
   → lib/officer.js  intent router (regex, closed set) → lib/graph.js query builders
   → live Graph gateway (Studio dev URL or gateway + GRAPH_API_KEY)
   → answer assembly with citations → page renders question · query · cited answer
```

- `lib/graph.js` — gateway client (`SUBGRAPH_URL`, `GRAPH_API_KEY`) + pure query builders.
- `lib/officer.js` — intent parsing, answer assembly, citation packing. Pure functions.
- Tests (`node --test`): builders + assembly against **recorded fixtures** in `test/fixtures/`.
  The fixtures never serve the demo path.

---

## 5. Ops / deploy (human-in-the-loop)

1. `cd subgraph && npm i && npm run prepare:sepolia` (needs `contracts/deployments/11155111.json`
   from Luiz's deploy) → `npm run codegen && npm run build`.
2. **Studio:** create subgraph `passportkit-sepolia` → `graph auth <DEPLOY_KEY>` → `npm run deploy`.
3. Concierge `.env`: `SUBGRAPH_URL` (Studio dev URL is fine for judging; gateway URL +
   `GRAPH_API_KEY` once published).
4. Seed Sepolia with demo traffic (identities, claims, a revoke) so the officer has real rows.

Cut order: the subgraph + officer + page all work against any address set — if the Sepolia deploy
slips, everything is verified on fixtures/tests and deployed the moment addresses land.
