# World ID checks — personhood, Selfie Check (beta), Identity Check (preview)

The `/passport` page carries a **World ID** row with three cards, each backed by the
same request/verify pipeline in `apps/api/src/world-id/`:

| Check | IDKit preset | Claim topic | Portal action (default) |
| --- | --- | --- | --- |
| Proof of Human | `proofOfHuman` | `PROOF_OF_PERSONHOOD` | `passportkit-verify` (`WORLD_ACTION`) |
| Selfie Check (beta, credential 11) | `selfieCheckLegacy` | `SELFIE_VERIFIED` (90-day claim) | `passportkit-selfie` (`WORLD_ACTION_SELFIE`) |
| Identity Check (preview) | `identityCheck` (passport, 18+) | `IDENTITY_ATTESTED` | `passportkit-identity` (`WORLD_ACTION_IDENTITY`) |

Flow per card:

1. `POST /world-id/request { check }` — the api signs a short-lived RP context
   (`@worldcoin/idkit-server`) and returns `app_id`, the check's `action`, the
   **environment**, and (for the identity check) the attribute policy.
2. `IDKitRequestWidget` opens with exactly that payload. Identity Check runs with
   `allow_legacy_proofs={false}` (it is 4.0-only); the other two accept 3.0 fallback.
3. `POST /world-id/verify { check, idkitResponse }` — the api forwards the IDKit
   result **byte-for-byte** to `https://developer.world.org/api/v4/verify/{rp_id}`,
   checks `identity_attested` for the identity check, guards nullifier replay, then
   signs the check's claim. The holder's wallet submits it (`Identity.submitClaim`);
   in `DEMO_MODE` without issuer keys the result is explicitly MOCK.

## Environments — read this before testing (it is what sank PRs #11/#12)

The IDKit `environment`, the Developer Portal **action's environment**, and the
device completing the flow must all match. A mismatch still *looks* fine on the
phone — the World App completes its local flow — but the proof can never pass the
cloud verifier, so the site reports failure. That exact symptom (QR ok, phone says
verified, website says failed) was PRs #11/#12: the widget was pinned to
`environment="staging"` while testers scanned with the production World App.

| `WORLD_ENV` | Scan with | Portal action environment |
| --- | --- | --- |
| `production` (default) | Real World App on a phone | production |
| `staging` | [World ID Simulator](https://simulator.worldcoin.org) only | staging |
| `sandbox` | Sandbox World ID app ([how to get access](https://docs.world.org/world-id/sandbox/sandbox-access)) | — |

Selfie Check end-to-end testing is a **sandbox** flow: install the sandbox World ID
build (TestFlight / Firebase link from the World booth) and set `WORLD_ENV=sandbox`.
See [Testing Selfie Check in Sandbox](https://docs.world.org/world-id/sandbox/testing-selfie-check).

Verifier rejections now surface the Developer Portal's `code`/`detail` (e.g.
`all_verifications_failed — face: verification_error`) in the api log and the card,
instead of a bare "failed".

## Configuration (`apps/api/.env`)

```
WORLD_APP_ID=app_...            # Developer Portal app
WORLD_RP_ID=rp_...              # RP minted when enabling World ID 4.0
WORLD_RP_SIGNING_KEY=0x...      # server-only; never NEXT_PUBLIC_*, never logged
WORLD_ENV=production            # production | staging | sandbox (see table above)
WORLD_ACTION=passportkit-verify
WORLD_ACTION_SELFIE=passportkit-selfie
WORLD_ACTION_IDENTITY=passportkit-identity
WORLD_IDENTITY_MINIMUM_AGE=18
```

Each action must exist in the Developer Portal **in the environment you test in**.
Selfie Check and Identity Check are gated betas — have the World booth enable them
for the app (`developers@toolsforhumanity.com` outside a hackathon). The precheck
endpoint (`POST https://developer.world.org/api/v1/precheck/{app_id}` with
`{"action": "..."}`) tells you whether a capability is enabled before you burn
demo time on an unexplained spinner.

## Provisioned resources (team `passportkit`, 2026-07-26)

Created through the Developer Portal MCP; only the signing key is secret and it
lives solely in `apps/api/.env` (returned once at mint time — losing it means a
confirmed rotation).

- App: `app_9e3d2003799702f4260df63889b777ce` (external / IDKit mode)
- RP: `rp_a0978245ff2b46b0` — on-chain registration **registered** in production
  and staging; signer address `0x886492f62CFC97DefD22b82d09E5e2BA902542fA`
- Actions: `passportkit-verify`, `passportkit-selfie`, `passportkit-identity`,
  each in **both** production and staging, so switching is `WORLD_ENV` only
- `enable_face_check: true` — Selfie Check capability is on for this app
- Heads-up: the portal defaults actions to `max_verifications: 1` per World ID —
  repeated end-to-end tests from one phone will eventually hit
  `max_verifications_reached`; raise the limit in the dashboard when it bites.
- The Developer Portal MCP server is registered project-scoped in
  `FINAL/world/.mcp.json` (gitignored — it embeds the team API key).

## Run

```bash
npm run start --workspace=apps/api          # api on :3005 (see .env PORT)
npm run dev --workspace=apps/web -- --port 3003
```

Connect a wallet on `/passport`; the World ID row creates the identity when needed.
With deployed issuer/factory/gate and keys, each verified check ends in a wallet
`submitClaim` transaction; otherwise the card visibly says MOCK.

## Replay protection

Every verified proof's `(action, nullifier)` pair is recorded; the same World ID
re-verifying the same check on a **different wallet** is refused. The store is
in-memory (demo-grade) — production needs the documented `NUMERIC(78,0)` +
`UNIQUE (action, nullifier)` column instead.
