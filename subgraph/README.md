# PassportKit subgraph

Indexes the PassportKit stack on **Ethereum Sepolia**: identities, claim lifecycle,
issuer revocation latches, issuer trust, policies, agent links, gated transfers,
ENS subnames/tenants — plus **index-time eligibility snapshots**: on every claim or
latch event the mapping re-runs `EligibilityGate.isEligible(identity, policyId)`
and stores the outcome, so the history of the gate's answers is queryable.

Full event schema + entity model: [`docs/specs/graph-spec.md`](../docs/specs/graph-spec.md).

## Build

```bash
npm install
npm run prepare:sepolia   # subgraph.yaml from contracts/deployments/11155111.json
                          # (falls back to config/sepolia.json zeros pre-deploy)
npm run codegen
npm run build
```

Addresses + `startBlock` come from `contracts/deployments/<chainid>.json`, written by
`DeployPassportKit.s.sol` — never hand-edited. Re-run `prepare:sepolia` after a deploy.

## Deploy (Subgraph Studio)

```bash
npx graph auth <DEPLOY_KEY>       # from https://thegraph.com/studio/ (subgraph: passportkit-sepolia)
npm run deploy
```

Consumers (the compliance officer in `apps/concierge`) take the endpoint via
`SUBGRAPH_URL` — the Studio dev URL works for judging; the gateway URL
(`https://gateway.thegraph.com/api/subgraphs/id/…`) needs `GRAPH_API_KEY`.

## Entities in one breath

Current state: `Identity`, `Wallet`, `Claim` (with decoded `expiresAt`),
`RevocationLatch`, `AgentLink`, `Issuer`/`IssuerTrust`, `Policy`,
`PassportPolicyStatus`, `Subname`, `Tenant`, `SignerStatus`.
Audit trail (immutable): `ClaimEvent`, `AgentEvent`, `TokenTransfer`,
`EligibilitySnapshot` (identity x policy x outcome x trigger, per event).
