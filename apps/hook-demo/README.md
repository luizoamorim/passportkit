# ComplianceHook demo

Local demo of the Uniswap v4 **ComplianceHook** — two pools gated by the same
AccessGate that guards the Deal Room:

| Pool | Policy | Who can swap / add liquidity |
|---|---|---|
| Deal Room pool | `canAccessDealRoom` | passport LIMITED or GREEN |
| Investor pool | `canAccessInvestorArea` | passport GREEN only |

Removing liquidity is never gated — funds are never trapped.

## Run

```bash
cd apps/hook-demo
npm install       # first time only
npm start         # → http://localhost:4180
```

The server is self-healing: it starts anvil if none is running and deploys the demo
world (`contracts/script/DeployHookDemo.s.sol`) if the hooks aren't on-chain.
Full reset: **↺ Reset world** in the UI, or `pkill anvil && npm start`.

## Actors (anvil dev accounts)

| actor | role | starts with |
|---|---|---|
| operator | issuer + simulated CRE + LP | GREEN passport (seeded both pools) |
| ana | investor onboarded live | nothing |
| rui | stranger | nothing |

## Demo script (~2 min)

1. **Rui swaps** → `NotCompliant(KYC_MISSING)`.
2. **⚡ Verify Ana's KYC** (submitClaim + syncPassport, like the CRE) → LIMITED →
   Deal Room pool trades.
3. **Ana on the Investor pool** → `ACCREDITATION_MISSING`; verify accreditation →
   GREEN → unlocked.
4. **Ana adds liquidity**, revoke her KYC claim → pools refuse her — **Exit position
   still works**.
5. **⏩ Fast-forward 1 year** → claims expire; even the operator gets `KYC_EXPIRED`.
   Compliance is live, not a snapshot.

## API

```
GET  /api/state
POST /api/swap             {"actor":"ana","pool":"deal|investor","zeroForOne":true}
POST /api/liquidity        {"actor":"ana","pool":"deal","direction":"add|remove"}
POST /api/verify           {"actor":"ana","claim":"kyc|accredited","approved":true}
POST /api/revoke-claim     {"actor":"ana","claim":"kyc"}
POST /api/revoke-passport  {"actor":"ana"}          (permanent, like the real contract)
POST /api/timewarp         {"days":366}
POST /api/reset            {}
```

Refusals come back decoded from v4's `WrappedError`, e.g.
`{"ok":false,"reason":"ACCREDITATION_MISSING","message":"NotCompliant(0x7099…79C8, ACCREDITATION_MISSING)"}`.

`npm test` covers the revert decoder (`lib/decode.js`).
