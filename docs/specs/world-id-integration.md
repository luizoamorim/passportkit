# World ID Integration — Build Plan (roteiro)

**Branch:** `feature/world-id`. Goal: World ID is the demo's **real** verification (KYC + personhood),
with **two flows** — **Self Check (selfie)** and **ID Verification (document)**. Accredited stays a
labeled mock. Zero PII on-chain (IDKit returns a cryptographic proof, we store only a hash).

> Drop-in: the World handler is the real evidence source for a claim; the rest of the pipeline
> (issuer signs EIP-712 → user submits via `Identity.submitClaim` → gate re-verifies) is UNCHANGED.
> Contracts need **zero changes** — the 3 topics are already trusted on the deployed IssuerRegistry.

## Mapping (2 World flows → 2 real claims)
| World flow | verification_level | Our topic | Result |
|---|---|---|---|
| **Self Check** (selfie, low-friction) | `Device`/selfie | `PROOF_OF_PERSONHOOD` | real |
| **ID Verification** (document / NFC) | `Document` | `KYC_VERIFIED` | **real** |
| — | — | `ACCREDITED_INVESTOR` | mock (labeled) |

Confirm the exact `verification_level` enum in the IDKit docs at build time
(https://docs.world.org/world-id/idkit/integrate). Orb is available as a stretch (highest level).

## Deployed context (Sepolia, see docs/DEPLOYMENTS.md)
ClaimIssuer `0x56F97734cC4d80af950538eAA6976398b5E58Fa9` · IdentityFactory `0x23504699EAcc1842d01998C0D57C53a2CF1638A0`
· agent/signer `0xEc98…f2A4`. `PROOF_OF_PERSONHOOD` + `KYC_VERIFIED` already `setTrusted` on IssuerRegistry.

---

## Phase 1 — Backend: `POST /issuer/world-verify` (or `/world/verify`)

Reuses the existing **`IssuerSigningService.signClaim`** (apps/api/src/issuer/) — do NOT rebuild signing.

Files to create:
- `apps/api/src/world/world.service.ts`
  - `verify(kind, proof, nullifierHash, merkleRoot, signal)` → validate the World proof.
    - MVP: call World's cloud verify (`https://developer.worldcoin.org/api/v2/verify/{app_id}` with `{ action, proof, merkle_root, nullifier_hash, verification_level }`) OR `@worldcoin/idkit-core` `verifyCloudProof`. Needs `WORLD_APP_ID` + the action per kind.
    - Graceful-degrade like revocation.service: if `WORLD_APP_ID` unset, `DEMO_MODE` lets it pass with a labeled mock (so the demo works before keys arrive).
  - Returns the sanitized reference (the `nullifier_hash`) — NEVER PII.
- `apps/api/src/world/world.controller.ts`
  - `POST /world/verify { identity, kind, proof, merkle_root, nullifier_hash }`, `kind ∈ {'selfie','document'}`.
  - topic = kind==='selfie' ? PROOF_OF_PERSONHOOD : KYC_VERIFIED (use `CLAIM_TOPICS` from issuer/claim-topics.ts).
  - `dataHash = keccak256(toHex(JSON.stringify({ world: true, kind, nullifier_hash })))` (sanitized, no PII).
  - `nonce = 0x${randomBytes(32)}`, `expiresAt = 0` (or +365d).
  - call `signing.signClaim({ identity, topic, dataHash, expiresAt, nonce })` → return `{ signature, data, issuer, topic }`.
  - DTO with class-validator (`@IsEthereumAddress` identity, `@IsIn(['selfie','document'])` kind, proof fields strings).
- `apps/api/src/world/world.module.ts` — controller + service; `imports: [IssuerModule]` (exports IssuerSigningService).
- `apps/api/src/app.module.ts` — add `WorldModule`.
- `.env` (api): `WORLD_APP_ID`, `WORLD_ACTION_PERSONHOOD`, `WORLD_ACTION_KYC` (+ existing ISSUER_SIGNER_PRIVATE_KEY, CLAIM_ISSUER_ADDRESS).
- deps: `@worldcoin/idkit-core` (or none — plain `fetch` to the verify API).

Test: `world.service.spec` — verify DEMO_MODE mock path returns ok; controller returns a signed claim (mock signing service).

## Phase 2 — Frontend: dual IDKit card

- `apps/web/src/components/world/WorldVerifyCard.tsx`
  - Two actions rendered as two buttons/cards: **Self Check** and **ID Verification**.
  - Use `IDKitWidget` (`@worldcoin/idkit`) with `app_id`, `action` (per kind), `verification_level`, `onSuccess`.
  - `onSuccess(proof)` → `POST /world/verify { identity, kind, proof… }` (apiFetch) → get `{ signature, data, issuer, topic }` → `Identity.submitClaim(topic, issuer, sig, data)` from the **user wallet** (viem walletClient over Privy/window.ethereum, mirror lib/onchain.ts).
  - Reuse the `kit.tsx` Card/Pill/Btn styling.
- Wire into a screen: a new `/verify` page OR a section on `/passport`. (Recommend `/verify` for the demo clarity.)
- `.env` (web): `NEXT_PUBLIC_WORLD_APP_ID`, `NEXT_PUBLIC_WORLD_ACTION_PERSONHOOD`, `NEXT_PUBLIC_WORLD_ACTION_KYC`.
- dep: `@worldcoin/idkit`.

## Phase 3 — Show it
- After a World verify, the user's identity has the real claim → `EligibilityGate.isEligible` flips → visible on `/live` (or `/passport`).
- Optional: bind the verified identity to an ENS subname (WireEnsDemo pattern) so `name.casaazul.eth` resolves the real World-backed status.

## Acceptance criteria
- [ ] Two working World flows; each returns a proof that the backend validates + signs a claim.
- [ ] Self Check → PROOF_OF_PERSONHOOD; ID Verification → KYC_VERIFIED (both real, user-submitted, Model B).
- [ ] Accredited remains a labeled mock.
- [ ] No PII on-chain (only a hash of {world,kind,nullifier}).
- [ ] Works before keys via DEMO_MODE fallback; real once WORLD_APP_ID + actions are set.

## Open items (get from the World booth)
- `WORLD_APP_ID` + action IDs (personhood, kyc) + confirm **Document verification** is enabled on the app.
- Exact IDKit `verification_level` values for selfie vs document.
- Decide screen: `/verify` new page vs section on `/passport`.

## Execution order (post-compact)
1. Backend Phase 1 (world.service + controller + module + app.module + .env) — verify tsc + a spec.
2. Frontend Phase 2 (WorldVerifyCard + /verify page + .env) — `npm i @worldcoin/idkit`, tsc + next build.
3. Wire into the demo + optional ENS bind.
Commit per phase; PR `feature/world-id` → develop.
