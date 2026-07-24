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
**↺ Reset world** resets the chain (`anvil_reset`, clock included) and redeploys.

## Actors (anvil dev accounts)

| actor | role | starts with |
|---|---|---|
| operator | issuer + simulated CRE + LP | GREEN passport (seeded both pools) |
| ana | investor onboarded live | nothing |
| rui | stranger | nothing |

Every card shows the passport, both claims (with expiry), pool access with the
hook's reason code, the actor's **LP position per pool**, and token balances.
Swap/liquidity log lines carry the exact token deltas.

## Transactions

- **Built-in inspector** — click any tx hash in the log: status, gas, and fully
  decoded events (`ClaimUpdated`, `PassportMinted`, `Swap`, `ModifyLiquidity`, …).
- **Otterscan** (optional, local explorer UI): `make hook-demo-explorer`
  (Docker; anvil exposes the `ots_*` API natively) → http://localhost:5100.
- **Testnet explorer** — set `EXPLORER_URL` in `.env` and hashes also link out
  (e.g. Etherscan on Sepolia).

## Ethereum Sepolia

Copy `env.example` to `.env` and fill in: `RPC_URL`, `EXPLORER_URL`, funded
`OPERATOR_PK`/`ANA_PK`/`RUI_PK`, and `POOL_MANAGER`
(canonical v4 on Sepolia: `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`). Then:

```bash
cd contracts && set -a && source ../apps/hook-demo/.env && set +a && \
  forge script script/DeployHookDemo.s.sol --rpc-url $RPC_URL --broadcast
cd ../apps/hook-demo && npm start
```

Timewarp and reset are local-only; claim-expiry demos need real time on testnets.

## Demo script (~2 min)

1. **Rui swaps** → `NotCompliant(KYC_MISSING)`.
2. **⚡ Verify Ana's KYC** (submitClaim + syncPassport, like the CRE) → LIMITED →
   Deal Room pool trades.
3. **Ana on the Investor pool** → `ACCREDITATION_MISSING`; verify accreditation →
   GREEN → unlocked.
4. **Ana adds liquidity** (watch position + deltas), revoke her KYC claim → pools
   refuse her — **Exit still works**.
5. **⏩ Fast-forward 1 year** → claims expire; even the operator gets `KYC_EXPIRED`.
6. Click a **tx hash** — decoded events, straight from the chain.

## API

```
GET  /api/state
GET  /api/tx/<hash>        receipt + decoded events
POST /api/swap             {"actor":"ana","pool":"deal|investor","zeroForOne":true}
POST /api/liquidity        {"actor":"ana","pool":"deal","direction":"add|remove"}
POST /api/verify           {"actor":"ana","claim":"kyc|accredited","approved":true}
POST /api/revoke-claim     {"actor":"ana","claim":"kyc"}
POST /api/revoke-passport  {"actor":"ana"}          (permanent, like the real contract)
POST /api/timewarp         {"days":366}             (local only)
POST /api/reset            {}                       (local only)
```

Refusals come back decoded from v4's `WrappedError`, e.g.
`{"ok":false,"reason":"ACCREDITATION_MISSING","message":"NotCompliant(0x7099…79C8, ACCREDITATION_MISSING)"}`.

`npm test` covers the revert decoder, env parsing, and position aggregation.
