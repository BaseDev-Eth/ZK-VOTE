# Stellar payment security invariants

This document records the payment/swap invariants enforced by the relayer.

## Pinned protocol versions

| Surface | Pinned version / unit |
| --- | --- |
| Soroban SDK | `25.3.0` |
| Stellar JavaScript SDK | `15.1.0` |
| `snarkjs` | `0.7.5` |
| Horizon classic-asset precision | 7 decimals (`10^7` stroops per unit) |
| Soroban token precision used by payment bridges | 12 decimals |

A Horizon stroop maps to exactly `10^5` Soroban token units. Conversions use integer arithmetic only. A 12-decimal Soroban amount that is not divisible by `10^5` is rejected rather than rounded for Horizon.

## Soroswap contract pinning

`SOROSWAP_API` is not trusted to choose the contract that a quote represents. Soroswap fallback remains disabled unless `SOROSWAP_CONTRACT_ID` is configured with the exact reviewed `C...` router contract. Every fallback response must return the same contract id; missing or mismatched ids are rejected and counted by `zkvote_swap_contract_rejected_total`.

The frontend independently checks `VITE_SOROSWAP_CONTRACT_ID` before displaying a Soroswap quote. Backend and frontend pins must match at deployment time.

## Trustlines

XLM does not use a trustline. USDC/EURC payments require both the relayer and destination account to have the matching asset trustline.

The relayer can sign `changeTrust` for its own account and therefore creates its missing trustline automatically. It cannot create a trustline for an arbitrary destination account: that operation requires the destination account signature. The payment API therefore preflights destination trustlines and returns an actionable error before submitting a payment when the line is missing or awaiting issuer authorization.

`GET /pay/trustline?account=G...&asset=USDC` exposes that preflight to the UI. Failures are counted by `zkvote_trustline_preflight_failure_total`.

## BN254 host-call bound

The Groth16 verifier rejects BN254 pairing vectors unless both sides contain exactly four terms. Voting batch size is currently capped at one proof so an attacker cannot amplify Protocol-25 host pairing cost through an `N + 3` batch vector. The length check occurs before the host pairing function is invoked.
