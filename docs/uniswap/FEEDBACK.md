# Uniswap v4 Hooks — Feedback from building a compliance/gating hook

We built a permissioned (KYC/compliance) hook on v4 and shipped it to Sepolia. Here's what we hit, in order of how much it cost us. Most of these are ecosystem-wide, not specific to our hook.

## 1. Hooks that gate on *who* have no trustworthy actor

`sender` in the hook callbacks is the router, not the trader. So any hook whose decision depends on the acting wallet — compliance, allowlists, per-user limits, KYC — has to take the actor from `hookData`, which is self-declared by whoever builds the call. Our `_actor(sender, hookData)` falls back to `sender` when `hookData` is empty, and we documented it as a known limitation — but it means the security of a compliance hook is really the security of the periphery in front of it.

**Ask:** an authenticated actor field in the callback, or a canonical way to assert "this router faithfully forwards `msg.sender`," or an official registry of trusted periphery. Right now every gating hook in the ecosystem is reimplementing the same unsound assumption.

## 2. The hook address is coupled to the hook's configuration

Permissions live in the low 14 bits, so hooks are CREATE2-mined. That's fine — but the consequence is that the mined address depends on the constructor args, so changing any immutable re-mines the address, which orphans the pool.

Adding one `bootstrapLp` immutable to `ComplianceHook` produced entirely new addresses (`0xfA1df80d…` → `0x9296d270…`), stranding two already-verified hooks and their initialized pools. A pool cannot follow its hook through a config change: you have to redeploy the hook, re-initialize the pool, and migrate liquidity. For a compliance hook — where the gate address or policy id may legitimately need to change — that's a real operational cliff.

## 3. A gated `beforeAddLiquidity` makes a pool un-seedable at genesis

This is a design discovery, not a complaint, and it generalizes to every permissioned pool: if the hook gates liquidity provision, the first LP must already pass the gate — but on a fresh deployment nobody does, and an empty pool demonstrates nothing. There's no guidance on this anywhere.

The fix we shipped is a reusable pattern: an immutable `bootstrapLp` that is (a) add-liquidity only, never swap; (b) one-shot — `isBootstrapping()` goes false the moment the pool holds liquidity, checked via `StateLibrary.getLiquidity`; and (c) `address(0)`-disableable.

## 4. Refusal reasons are second-class

For a gating hook the revert reason is the product — a user needs "MISSING_KYC" vs. "claim expired" vs. "not accredited," and a frontend needs to render it. v4 wraps hook reverts in `CustomRevert.WrappedError`, and in our trace the error nested several levels deep before surfacing. Decoding `NotCompliant(address,bytes32)` out of that requires a frontend to unwrap layers of nested custom errors it didn't author.

**Ask:** a first-class way to surface a structured refusal from a hook to a caller.

## 5. Tests skip the thing most likely to break deployment

`deployCodeTo` skipping address mining is great for test speed — genuinely, say so. But it means the test suite never exercises the real deployment path. Our 137 passing tests could not have caught a deploy-script bug (a `vm.envOr` default evaluated eagerly); only a live dry-run did.

## 6. Small tooling notes

- `forge script --verify` raced the node repeatedly (`Could not detect deployment: Unable to locate ContractCode at…`) and then reported `Not all (3 / 4) contracts were verified` when in fact all four had verified — a retry confirmed "already verified." Misleading exit status; with `set -e` it aborts scripts after a successful deploy.
