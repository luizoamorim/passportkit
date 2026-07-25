# Deployments

## Ethereum Sepolia (chainId 11155111)

Deployed 2026-07-25 (startBlock **11350114**). Admin / agent / issuer-signer = `0xEc98B58F86a32aAd7B32E17f292e6B640487f2A4`.

| Contract | Address |
|---|---|
| **PassportResolver** | `0x36064023898d0451C6763a171e080b18123BE83E` |
| EligibilityGate | `0x51574D5830461FD38022987621C7bdf3a996b8d1` |
| IdentityFactory | `0x23504699EAcc1842d01998C0D57C53a2CF1638A0` |
| ClaimIssuer | `0x56F97734cC4d80af950538eAA6976398b5E58Fa9` |
| IssuerRegistry | `0xcAa549B8f1ef449BEeD00D7Bb88a828AB9E70AE7` |
| GatedERC20 | `0xe3a29101263567c400A0d4d47C52912d3Ed0a08d` |
| ScoreRegistry | `0x010c452FEC23669Be2D076Efe0CAEEb28c82Aa6E` |
| PassportSubnameRegistrar | `0xb41FfDBeB9Ac19359D861AB13F3E05356B68a34B` |

Policies wired: `#1 Deal Room = [KYC_VERIFIED]`, `#2 Investor = [KYC_VERIFIED, ACCREDITED_INVESTOR]`.
Tenant wired for `casaazul.eth` (namehash) → gate + policy #1.

### ENS
- `casaazul.eth` registered on the **ENSv2** Sepolia testnet (the classic v1 registrar is orphaned on this deployment). ENSv2 supports **custom resolvers** (interface unchanged), so `casaazul.eth`'s resolver can point at our **PassportResolver**.
- ENSv2 Sepolia: ETHRegistry `0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67`, ETHRegistrar `0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA`.
