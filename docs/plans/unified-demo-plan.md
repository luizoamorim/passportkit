# Unified PassportKit Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One website — `apps/web` — where a visitor connects a wallet once and walks a single story: get a passport, enter the Deal Room, trade a compliance-gated pool, then hand an AI concierge a mandate and watch it spend. Today that is three disconnected demos on three ports with three visual languages.

**Architecture:** Fold `apps/hook-demo` and `apps/concierge` into the Next.js app as routes (`/markets`, `/concierge`), converting their node servers into Next route handlers that reuse the existing `lib/` modules verbatim. One wallet layer (wagmi, from PR #12), one design system, one chain world deployed by one script.

**Tech Stack:** Next.js 14 App Router, wagmi + viem, Tailwind, node:test for the ported libs, Foundry for the deploy script. No new dependencies.

## Global Constraints

- Branch: `feat/unified-demo`, cut from `develop`. **Commit after every task: short imperative title, no body, no AI-assistant mentions.** Conventional prefixes matching the repo (`feat(web):`, `refactor(web):`, `chore:`, `docs:`).
- **Docs travel with the code, not after it.** Every task that changes behaviour updates the docs it invalidates *in the same commit*: `README.md` (how to run, what exists), `CLAUDE.md` (layout + conventions), and the spec whose surface moved (`docs/specs/uniswap-hook-spec.md`, `docs/specs/agent-concierge-spec.md`). A task is not done while a doc still describes the thing it replaced. Task 10 is the final sweep, not the first time docs are touched.
- **One anvil world.** A single `DeployAll.s.sol` deploys the PassportKit stack, both gated pools and the house treasury into one world and writes one `apps/web/demo-addresses.json`. This removes today's bug where resetting one demo wipes the other's contracts.
- Demo-only server code lives under `apps/web/src/app/api/demo/**` and is **local-anvil only**: every route calls `assertDemo()` first and returns 403 when `DEMO_MODE !== 'true'`. Actor private keys stay server-side — never in a `NEXT_PUBLIC_*` var.
- Reuse, don't rewrite: `lib/deciders.js`, `evidence.js`, `x402.js`, `decode.js`, `positions.js` move as-is. Their existing tests move with them and must stay green.
- Design tokens are the ones already in `apps/web/tailwind.config.ts`: navy `#0D1428` on `#F0F2F6`, gradient `#4A9EFF → #3DDBD9`, Inter + JetBrains Mono, white cards with `#DDE1EA` borders, uppercase tracking-widest cyan eyebrows. The two demo pages adopt these — no port of the standalone CSS.
- Contracts (`contracts/src/**`), `apps/api` and `cre/` are **not** touched by this plan, except Task 1's dependency move and Task 2's new script.
- Every task ends with `npm run build --workspace=apps/web` passing (see Task 1 — the build is broken today and must be fixed first).

---

## File Structure

```
apps/web/src/app/
  layout.tsx                    + AppShell (nav, wallet, chain chip)
  page.tsx                      rewritten: one story, four entry points
  passport/page.tsx             unchanged behaviour, adopts shell
  deal-room/page.tsx            unchanged behaviour, adopts shell
  markets/page.tsx              NEW — was apps/hook-demo/index.html
  concierge/page.tsx            NEW — was apps/concierge/index.html
  api/demo/
    world/route.ts              GET state + POST reset|timewarp (local only)
    markets/route.ts            POST swap|liquidity|verify|revoke
    concierge/route.ts          POST ticket|approve|fund|mandate|owner-kyc
    tx/[hash]/route.ts          receipt + decoded events
    vendor/invoice/route.ts     the x402 mock plumber
apps/web/src/lib/demo/          deciders.js evidence.js x402.js decode.js positions.js chain.ts
apps/web/src/components/
  shell/AppShell.tsx  Nav.tsx  ChainChip.tsx  DemoBanner.tsx
  demo/ActorCard.tsx  TxLog.tsx  TxInspector.tsx  StatusPill.tsx  ReasonBadge.tsx
  connect/ConnectMenu.tsx       from PR #12, reused everywhere
contracts/script/DeployAll.s.sol   NEW — one world
```

Deleted at the end (Task 10): `apps/hook-demo/`, `apps/concierge/` and their Makefile targets.

---

### Task 1: Unblock the web build

**Files:** Modify `apps/api/package.json`, `apps/api/tsconfig.build.json`, `package-lock.json`

**Interfaces:** Produces a web app that builds. Every later task depends on this.

`next build` fails today on `develop`: `/404` and `/500` prerender with `TypeError: Cannot read properties of null (reading 'useContext')` because React 19 is hoisted to the workspace root (via `apps/api`'s `prisma` → `@prisma/studio-core` → radix-ui) while `apps/web` pins 18.3.1, and the root `overrides` are not applied — the lockfile records `overrides: None` even when regenerated from scratch.

- [ ] **Step 1: Reproduce**

```bash
cd apps/web && npx next build 2>&1 | tail -20      # /404 /500 prerender error
node -e "console.log(require('../../node_modules/react/package.json').version)"   # 19.x
```

- [ ] **Step 2: Move `prisma` out of the hoisting path**

`apps/api/src/prisma/prisma.service.ts` and `apps/api/src/wallets/wallet-policy.service.ts` are the only files importing `@prisma/client`, and `app.module.ts` does not bootstrap them. Move `prisma` and `@prisma/client` from `dependencies` to `optionalDependencies` in `apps/api/package.json`, and add `"exclude": ["src/prisma/**", "src/wallets/**"]` to `apps/api/tsconfig.build.json` so `nest build` ignores the legacy files.

- [ ] **Step 3: Force the React override to apply**

```bash
rm -rf node_modules apps/*/node_modules package-lock.json && npm install
node -e "console.log(require('./node_modules/react/package.json').version)"   # must print 18.3.1
```

- [ ] **Step 4: Verify**

```bash
cd apps/web && npx next build     # succeeds, no prerender errors
cd ../api && npm start            # still boots (ts-node, transpile-only)
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.build.json package-lock.json
git commit -m "fix: unblock web build by unpinning react hoist"
```

---

### Task 2: One anvil world

**Files:** Create `contracts/script/DeployAll.s.sol`; modify `contracts/foundry.toml` (fs_permissions for `../apps/web/`); **docs:** `README.md` deploy section

**Interfaces:**
- Consumes: `DeployHookDemo.s.sol` and `DeployConciergeDemo.s.sol` on `develop` — this task merges them; read both first.
- Produces: `apps/web/demo-addresses.json` with keys
  `chainId, deployBlock, issuerRegistry, claimIssuer, identityFactory, eligibilityGate, poolManager, swapRouter, liquidityRouter, token0, token0Symbol, token1, token1Symbol, dealHook, investorHook, treasury, mandateHook, casa, musd, fee, tickSpacing, policies:{deal:1,investor:2}, actors:{operator,ana,rui,concierge,plumber}, identities:{operator,ana,rui}`.

- [ ] **Step 1: Write the script** — one `run()` that deploys the stack once (IssuerRegistry → ClaimIssuer → IdentityFactory → EligibilityGate, policies 1 and 2), onboards operator/ana/rui with identities and the same starting claims the two demos use today, deploys PoolManager + routers **once**, then both ComplianceHook pools **and** the house (HouseTreasury, MandateHook, CASA/mUSD pool, mandate cap 200e18 +365d, 500 CASA, 50k mUSD deposit) against that single PoolManager.

- [ ] **Step 2: Run it**

```bash
anvil --silent &
cd contracts && forge script script/DeployAll.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cat ../apps/web/demo-addresses.json      # every key above present
```

- [ ] **Step 3:** `forge test` — still 116/116 (the script must compile with the suite).

- [ ] **Step 4: Commit** — `git commit -m "feat: single deploy script for one demo world"`

---

### Task 3: Demo runtime moves into Next

**Files:** Create `apps/web/src/lib/demo/{deciders.js,evidence.js,x402.js,decode.js,positions.js,chain.ts}` and `apps/web/src/app/api/demo/world/route.ts`; move `apps/concierge/test/*.test.js` → `apps/web/test/demo/`; modify `apps/web/package.json`

**Interfaces:**
- Consumes: the five lib files from `apps/concierge/lib` + `apps/hook-demo/lib` (`decode.js`/`positions.js`/`env.js` are identical in both — keep one copy).
- Produces: `chain.ts` exporting `publicClient`, `walletFor(actor)`, `addresses()`, `demoEnabled()`, `assertDemo()`; `GET /api/demo/world` returning the merged state both pages need — `{ chainId, local, warped, now, contracts, actors[], pools{deal,investor,house}, house{...}, agent{...}, tickets[], payments[] }`; `POST /api/demo/world` with `{action:'reset'|'timewarp', days?}`.

- [ ] **Step 1:** Copy the libs unchanged; delete the duplicated copies. Move their tests; add `"test": "node --test test/demo/"` to `apps/web/package.json`.
- [ ] **Step 2:** Write `chain.ts` — read `demo-addresses.json`, build viem clients from the anvil keys in `process.env` (server-only), export `assertDemo()`.
- [ ] **Step 3:** Write the `world` route by lifting the state assembly out of both `server.js` files (they already compute actors, pools, agent standing, tickets, payments).
- [ ] **Step 4:** `npm test --workspace=apps/web` green; `curl localhost:3003/api/demo/world` returns the merged shape.
- [ ] **Step 5: Commit** — `git commit -m "feat(web): demo runtime as route handlers"`

---

### Task 4: Action routes

**Files:** Create `apps/web/src/app/api/demo/{markets,concierge,tx/[hash],vendor/invoice}/route.ts`

**Interfaces:** Produces —
`POST /api/demo/markets {action:'swap'|'liquidity'|'verify'|'revoke', actor, pool?, claim?, direction?}`;
`POST /api/demo/concierge {action:'ticket'|'approve'|'fund'|'grant-mandate'|'revoke-mandate'|'revoke-owner-kyc'|'restore-owner-kyc', ...}`;
`GET /api/demo/tx/<hash>` → `{status, blockNumber, timestamp, from, to, contract, gasUsed, logs[]}`;
`POST /api/demo/vendor/invoice` → the x402 402-challenge / settle pair.
Every response keeps today's shapes, including `refusal: {reason, wallet, message}` decoded from `WrappedError`.

- [ ] **Step 1:** Port the handlers from both `server.js` files one action at a time, calling `assertDemo()` first in each.
- [ ] **Step 2:** Replay the full curl scripts from both current READMEs against the new endpoints — refusal reasons must match exactly (`MISSING_KYC`, `MISSING_ACCREDITED`, `OWNER_NOT_COMPLIANT`, `MANDATE_REVOKED`, `OVER_PER_TX_CAP`).
- [ ] **Step 3: Commit** — `git commit -m "feat(web): demo action routes"`

---

### Task 5: App shell

**Files:** Create `apps/web/src/components/shell/{AppShell,Nav,ChainChip,DemoBanner}.tsx`; modify `apps/web/src/app/layout.tsx`; **docs:** `CLAUDE.md` frontend section

**Interfaces:** Produces `<AppShell>` wrapping every page: brand lockup, nav (Passport · Deal Room · Markets · Concierge), the PR #12 `ConnectMenu` top right, a chain chip (network + block + "clock warped" when applicable), and a `DemoBanner` shown only when `DEMO_MODE`.

- [ ] **Step 1:** Build the shell with the existing tokens; keep `Web3Provider` + `PrivyAppProvider` where PR #12 put them.
- [ ] **Step 2:** Wrap all four routes; confirm the wallet stays connected while navigating between them — this is the single clearest signal that it is now one app.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): shared app shell"`

---

### Task 6: `/markets` page

**Files:** Create `apps/web/src/app/markets/page.tsx` and `apps/web/src/components/demo/{ActorCard,StatusPill,ReasonBadge,TxLog}.tsx`; **docs:** `docs/specs/uniswap-hook-spec.md` status block (demo now lives at `/markets`)

**Interfaces:** Consumes `/api/demo/world` + `/api/demo/markets`. Reproduces every capability of `apps/hook-demo/index.html`: both pools with their policies, per-actor claims and access with reason codes, swap / add / exit buttons, issuer verify+revoke controls, the on-chain log.

- [ ] **Step 1:** Build the page from the shared components (no bespoke CSS).
- [ ] **Step 2:** Click through in the browser: refusal → verify → swap → policy separation → revoke → **exit still works**.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): markets page"`

---

### Task 7: `/concierge` page

**Files:** Create `apps/web/src/app/concierge/page.tsx`; add `apps/web/src/components/demo/TxInspector.tsx`; **docs:** `docs/specs/agent-concierge-spec.md` status block

**Interfaces:** Consumes `/api/demo/world` + `/api/demo/concierge`. Reproduces `apps/concierge/index.html`: house header, agent card with standing + budget + cap, owners with compliance and KYC controls, ticket composer with the two presets, ticket feed with decision + rationale + evidence hash, approval queue, world controls (fund, mandate, ⏩ 1 year, ↺ reset), and the tx inspector drawer — now shared with `/markets`.

- [ ] **Step 1:** Build the page. Escape all user- and LLM-derived text (keep the fix already made in the standalone app).
- [ ] **Step 2:** Click through: 120 auto-pays, 4500 queues, two approvals execute, revoking an owner kills both rails, restore, a jewelry ticket is rejected with no chain call.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): concierge page"`

---

### Task 8: The landing page tells one story

**Files:** Modify `apps/web/src/app/page.tsx`

- [ ] **Step 1:** Rewrite as a four-step narrative — *Get verified → Enter the Deal Room → Trade a compliant pool → Hand an agent a mandate* — each linking into its route and showing live state from `/api/demo/world` (e.g. "your passport: LIMITED", "pool liquidity: 10,000"). One sentence of thesis at the top: an agent's authority is borrowed from verified humans, and one revoke flips every surface.
- [ ] **Step 2:** Verify the four links land on the right routes with the wallet still connected.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): landing page narrative"`

---

### Task 9: One command to run it

**Files:** Modify `Makefile`, `apps/web/package.json`; create `apps/web/env.example`; **docs:** `README.md` quick-start

- [ ] **Step 1:** `make demo` → starts anvil if absent, runs `DeployAll`, starts `apps/web` on 3003. Keep `make hook-demo` / `make concierge-demo` as aliases that print a one-line deprecation and call `make demo`.
- [ ] **Step 2:** `env.example` documents `DEMO_MODE`, `RPC_URL`, `EXPLORER_URL`, the actor keys, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_PRIVY_APP_ID`.
- [ ] **Step 3:** From a clean checkout: `npm install && make demo`, then walk all four routes.
- [ ] **Step 4: Commit** — `git commit -m "chore: single make target for the demo"`

---

### Task 10: Retire the old demos, final doc sweep

**Files:** Delete `apps/hook-demo/`, `apps/concierge/`; modify `README.md`, `CLAUDE.md`, `WHATS-NEW.md`, `docs/presentation-diagrams.md`, both specs

- [ ] **Step 1:** Delete both apps and their Makefile targets; `grep -rn "hook-demo\|concierge-demo\|:4180\|:4190"` must return only historical references in `WHATS-NEW.md`.
- [ ] **Step 2:** Docs describe one site and one command: `README.md` (structure + quick start + the four routes), `CLAUDE.md` (monorepo layout, demo section, ports), both specs' status blocks, diagram 7 in `docs/presentation-diagrams.md` refreshed to the unified route order, and a dated `WHATS-NEW.md` entry.
- [ ] **Step 3:** Full sweep — `forge test` (116), `npm test --workspace=apps/web`, `npm run build --workspace=apps/web`, and a browser pass over all four routes.
- [ ] **Step 4: Commit** — `git commit -m "docs: one site, one demo command"`
- [ ] **Step 5:** Push `feat/unified-demo` and open a PR against `develop`.

---

## Risks

1. **Task 1 may not be solvable by dependency moves alone.** If React 19 still hoists, fall back to pinning `react`/`react-dom` as exact `18.3.1` in `apps/web`, and if that still fails, give `apps/web` its own lockfile outside the workspace. Do not start Task 3 until `next build` passes.
2. **Server-only keys.** The demo routes sign with anvil keys. `assertDemo()` on every route and no `NEXT_PUBLIC_` exposure is the whole defence; a reviewer should check this explicitly.
3. **Scope creep into the product pages.** `/passport` and `/deal-room` keep their current behaviour — they only gain the shell. Any change to their flows belongs to a separate plan.
4. **Deleting the standalone demos is irreversible mid-event.** Task 10 is last on purpose: everything must be verified working in `apps/web` before the old ones go.
5. **World reset semantics change.** With one world, `↺ Reset` now resets *both* demos at once. That is the intended fix, but the button copy must say so.
