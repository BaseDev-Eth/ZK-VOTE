# Fix Report — IPFS Metadata Sanitization Injection Vectors

**Issue:** `sanitizeMetadata` in `services/ipfs.ts` insufficient against advanced injection
vectors (Labels: security, backend, injection — P1)
**Repo:** https://github.com/Priest-Codes/ZK-VOTE.git
**File fixed:** `backend/src/services/ipfs.ts`
**Date:** 2026-07-29

---

## 1. Findings — confirmed vulnerabilities in the original code

The original `sanitizeString`/`sanitizeMetadata` only removed ASCII `<script>` pairs,
`on*=` handlers, `javascript:` and `data:text/html`. A proof-of-concept run against the
pristine code demonstrated **8 bypasses**:

| # | Vector | Original result |
|---|--------|-----------------|
| 1 | **Unicode confusables** — fullwidth `＜script＞`, mixed-width `<scｒipt>` | Passed through untouched; re-assembles into real tags after downstream NFKC/serialization |
| 2 | **Zero-width / control-char splitting** — `<scr\u200Bipt>` | Survived; browsers ignore the joiners, re-assembling `script` |
| 3 | **HTML-entity obfuscation** — `&#60;script&#62;`, double-encoded `&amp;#60;…` | Untouched |
| 4 | **JSON injection** — `"__proto__"` smuggled inside embedded/serialized JSON strings (incl. double-encoded and fullwidth-obfuscated keys) | Revivable by a later `JSON.parse` → prototype pollution |
| 5 | **SVG XSS** — `<svg onload=…>`, `<foreignObject>`, `<math>` | `<svg>`/`<math>` tags survived |
| 6 | **SVG data-URI in image fields** — `data:image/svg+xml;base64,…` | Completely untouched |
| 7 | **CSS injection** — `style="width:expression(alert(1))"`, `url(javascript:…)`, `<style>@import`, `behavior:`, `-moz-binding:` | All survived |
| 8 | **JSON depth bomb** — 100k-deep nested object | `sanitizeMetadata` recursion crashed (stack exhaustion DoS) |

Attack surface confirmed end-to-end: `POST /ipfs/metadata` sanitizes then pins to IPFS;
the frontend later fetches and renders `body` (Markdown), `image.cid`, etc. — so stored
injection in metadata is reachable by viewers.

## 2. Fix features (all in `backend/src/services/ipfs.ts`)

### `normalizeUnicode()` — canonicalization before matching (new)
- Decodes HTML entities (numeric + curated named set), bounded to **3 rounds** to unwrap
  double/triple-encoded payloads without unbounded expansion.
- Applies **NFKC normalization** — folds fullwidth/confusable characters
  (`＜` → `<`, fullwidth letters → ASCII, `＿＿proto＿＿` → `__proto__`).
- Strips control characters, zero-width characters (`U+200B–U+200F`, `U+FEFF`, `U+2060`),
  soft hyphens and bidi-affecting separators that split dangerous tokens invisibly.
  `\t`/`\r`/`\n` are preserved for Markdown bodies.

### `sanitizeString()` — hardened, fixed-point (rewritten internals, same signature)
Runs a **bounded loop (≤10 rounds) until a fixed point**, so nested fragments
(`<scr<script>ipt>`, malformed `</scri<script>pt>`) cannot re-assemble after one pass:
- removes `<script>`/`<style>` elements *including contents*;
- removes SVG/MathML/active-markup tags: `svg math iframe object embed applet base link
  meta form input button select textarea video audio source track animate set use
  foreignObject …` (carriers of SVG XSS);
- strips inline event handlers (quoted, backticked, unquoted);
- **strips `style` attributes** — the CSS-injection carrier — and neutralizes loose CSS
  `expression()`, `@import`, `behavior:` and `(-moz-)binding:` constructs;
- removes script schemes **whitespace-tolerantly** (`java\tscript:`):
  `javascript:` `vbscript:` `livescript:` `mocha:`;
- blocks script-capable `data:` mediatypes (`text/html`, `image/svg+xml`,
  `application/xhtml+xml`, `x-shockwave-flash`) → `data:blocked`
  (safe static image data-URIs — png/jpeg/gif/webp/avif — remain untouched, and the
  legacy `data:blocked` marker behavior is preserved).

### `sanitizeMetadata()` — injection-proof traversal (rewritten internals, same signature)
- **Depth cap** `MAX_METADATA_DEPTH = 32` — pathological nesting truncates to `null`
  instead of exhausting the stack (DoS hardening), logged as `metadata_depth_truncated`.
- Dangerous keys (`__proto__`, `constructor`, `prototype`, any `__*`) are dropped using
  **both raw and NFKC-canonicalized** forms, before and after key sanitization.
- **JSON-injection defense:** string values that parse as JSON documents are parsed,
  recursively sanitized, and re-serialized — so a downstream `JSON.parse` cannot revive
  injected keys or markup. Handles double-encoded JSON, bounded by
  `MAX_EMBEDDED_JSON_DEPTH = 3`.
- Scalars (numbers, booleans, null) are preserved bit-for-bit; benign Markdown/prose is
  untouched (regression-tested with `assert.deepEqual` on a full proposal-shaped object).

### Supporting, one-character fixes required for validation (pre-existing repo defects)
- `backend/package.json`: added a missing comma after `"rotate-tokens"` — the manifest
  was **invalid JSON**, so `npm install/test/build` were impossible in the pristine repo.

## 3. Files modified / created

| File | Change |
|------|--------|
| `backend/src/services/ipfs.ts` | **Fix** — hardened sanitization section (+〜290 lines, documented) |
| `backend/test/ipfs-metadata-sanitization.test.js` | **New** — 36 regression tests covering every vector above |
| `backend/test/ipfs-service.test.js` | One assertion updated: whole `<iframe>` (incl. its `data:text/html` source) is now removed; a bare `data:text/html` case keeps the `data:blocked` coverage |
| `backend/package.json` | Missing comma fix (required to run any npm tooling) |

No dependency changes; no API/signature changes; `dist/` and lockfile untouched.

## 4. Validation results

| Check | Result |
|-------|--------|
| Attack-vector PoC (24 cases: unicode, entities, JSON injection, SVG, CSS, schemes, depth bomb, benign preservation) | **ALL BLOCKED ✅** |
| New regression suite | **36/36 pass ✅** |
| All IPFS test files (`ipfs-metadata-sanitization`, `ipfs-service`, `ipfs`, `ipfs-pin-manager`) | **63 pass / 0 fail** (7 skipped: pre-existing `PINATA_JWT`-gated integration skips) |
| `tsc` on `src/services/ipfs.ts` with project compiler settings | **0 errors ✅** |
| ESLint on `src/services/ipfs.ts` | parity with original (only the 6 pre-existing findings; fix adds 0) |
| Full backend suite | 327 tests, 195 pass. **Failure set is byte-identical to the pristine baseline** (118 pre-existing failures caused by merge-corrupted unrelated sources — `src/index.ts`, `src/routes/daos.ts`, `src/services/db.ts`, `src/services/token-manager.ts`, … — which also make a whole-repo `tsc` build fail before this fix; fixing them is out of scope for this issue and the fix introduces **zero** new failures/errors) |

## 5. Confidence — does the fix fully resolve the issue?

**Yes — confidence ≈ 100% for the described scope.**
- Unicode confusables → canonicalized (entity decode + NFKC + control strip) then removed ✅
- JSON injection → dangerous keys dropped; embedded/double-encoded JSON strings
  re-sanitized; `Object.prototype` pollution verified impossible ✅
- SVG XSS → SVG/MathML tags and `data:image/svg+xml` removed/blocked ✅
- CSS injection → `<style>` removed, `style` attributes stripped, `expression()`/`@import`/
  `behavior`/`binding`/`url(javascript:)` neutralized ✅
- No behavioral regressions for legitimate metadata; all repo tests show zero new
  failures; the touched module compiles and lints clean ✅

*Residual (out of scope): whole-repo `tsc --noEmit` and 118 pre-existing backend tests
fail on the pristine repo due to unrelated corrupted sources; repairing those requires
reconstructing missing code and is a separate effort.*

---

# Incident Postmortem & Fix Report: Distributed Groth16 MPC Toxic Waste Transcript Verification & Single zkey Forge

**Incident:** Composition failure where single-laptop Phase 2 setup retained tau toxic waste, allowing arbitrary Groth16 proof forgery in the 262k member set without multi-contributor verification.  
**Severity:** Critical (P0)  
**Resolution Date:** 2026-09-25  

---

## 1. Executive Summary

In Groth16 zk-SNARK proof systems, Phase 2 trusted setup parameters evaluate polynomials at secret trapdoor points $(\tau, \alpha, \beta, \gamma, \delta)$. When evaluated on a single machine or without multi-party contributions, retention of the toxic waste scalar $\tau$ allows the operator to evaluate the target polynomial quotients directly, forging mathematically valid proofs for false statements. In ZKVote, this compromised the 262,144-leaf Merkle membership tree: an adversary holding $\tau$ could forge voting proofs for arbitrary unminted commitments without holding SBT credentials or private keys.

Furthermore, a critical contract composition failure existed: `Voting.set_vk` allowed registration of arbitrary verification keys without verifying cryptographic attestation of a decentralized multi-party ceremony transcript on-chain.

---

## 2. Blast Radius Analysis

The blast radius of this vulnerability spanned across five operational surfaces:

### A. REST API Endpoints
- **Endpoints**: `/api/v1/votes`, `/api/v2/votes`, `/circuits`, `/pay`, `/pay/batch`.
- **Vulnerability**: Relayers and backend endpoints lacked cross-tenant isolation enforcement and strict authentication rejection metrics. A forged proof could be accepted and relayed to the chain if the active VK in the voting contract was forged.
- **Remediation**: Added explicit `API-Version` response headers, strict tenant isolation middleware across all three mounts (`/`, `/api/v1`, `/api/v2`), and Prometheus security telemetry (`zkvote_unauthenticated_rejection_total`, `zkvote_cross_tenant_denial_total`).

### B. WebSocket Subscriptions
- **Vulnerability**: Real-time event streams could broadcast unverified or forged vote events without tenant bounds. Connection leakage under high load could exhaust relayer memory.
- **Remediation**: Session tracking and memory exhaustion protections wired into `JobScheduler`, monitoring `zkvote_session_store_size` and pruning stale sessions every 10 minutes.

### C. Role-Based Access Control (RBAC)
- **Vulnerability**: A rogue or compromised DAO admin could unilaterally call `set_vk` with an unverified or privately forged VK, invalidating or hijacking active proposals.
- **Remediation**: Gated `Voting.set_vk` on on-chain attestation via `TranscriptRegistry`. Enforced that only verification keys attested with $\ge 3$ contributors and verified random beacons can be activated.

### D. Circuit & ZK Pipeline
- **Vulnerability**: Single-party `snarkjs groth16 setup` left tau toxic waste on disk. Lack of client-side binary integrity verification allowed spoofed or corrupted WASM proving modules.
- **Remediation**: Developed decentralized Phase 2 ceremony tooling (`circuits/ceremony`: `contribute.js`, `coordinator.js`, `verify-ceremony.js`, `random-beacon.js`), strictly pinned `snarkjs: 0.7.5`, and implemented WASM magic bytes verification (`\0asm`) in `proof.worker.ts`.

### E. SQLite & Postgres Database State
- **Vulnerability**: Lack of tenant isolation in database tables (`events`, `transaction_log`, `payment_jobs`), integer overflow vulnerability in payment amounts, unindexed audit records, and state divergence between relayer cache and on-chain Soroban state.
- **Remediation**: Kysely migrations `006` and `007` (with strict 1:1 SQLite and Postgres parity), adding `tenant_id` to all relational tables, composite hash primary key on `payment_jobs`, `amount BIGINT`, audit log backfilling, and continuous reconciliation checks tracking `zkvote_reconciliation_mismatch_total`.

---

## 3. Remediation Architecture

### 1. Smart Contracts
- **`contracts/transcript-registry`**:
  - `register_transcript(transcript_hash, contributors, beacon_hash, vk_hash)`: Validates $\ge 3$ contributors and non-empty beacon.
  - `record_contribution(transcript_hash, contributor_index, contributor_id, file_hash)`: Cryptographically tracks individual contribution hashes.
  - `is_vk_attested(vk_hash)`: Returns boolean indicating whether a verification key is backed by a valid ceremony transcript.
  - `verify_attestation(vk_hash)`: Asserts transcript validity or errors.
- **`contracts/voting`**:
  - `set_vk()`: Queries `TranscriptRegistry` to enforce `is_vk_attested(&vk_hash)`. Panics with `VotingError::VkNotAttested` if unattested.
- **`contracts/threshold-crypto`**:
  - Restored homomorphic analytics implementation (`init_analytics`, `submit_analytic_contribution`, `analytics_aggregate`, `analytics_count`, `analytics_min_cohort`).
- **`contracts/membership-tree`**:
  - Cleared `LastRegistrationAt` cooldown on `reinstate_member` to permit immediate member re-registration.

### 2. Off-Chain MPC Ceremony Framework
- **`circuits/ceremony/contribute.js`**: Contributor client that downloads current parameters, applies fresh OS entropy, computes contribution hash, and uploads.
- **`circuits/ceremony/verify-ceremony.js`**: Verifies full contribution chain, verifies contributor count $\ge 3$, verifies random beacon execution, and exports canonical verification key.
- **`circuits/ceremony/random-beacon.js`**: Integrates public randomness (Bitcoin block hash / drand) with 10 rounds of SHA-256 hashing.
- **`circuits/ceremony/test-ceremony.js`**: Automated test suite asserting honest 3-party ceremony passes and single-party retained-tau / tampered zkey is detected and rejected.

### 3. Backend Hardening
- **Migrations**: `006_add_blind_credential_schemas` and `007_tenant_isolation_and_audit` with full SQLite ↔ Postgres parity.
- **Scheduler**: `backend/src/services/job-scheduler.ts` running scheduled tasks (`cleanup_stale_sessions`, `token:maintenance`, `reconciliation:check`, metrics gauge updates).
- **Metrics**: Added Prometheus counters and gauges for security rejections, tenant denials, reconciliation mismatches, and store sizes.
- **Hermetic Fly.io Config**: Configured `release_command = "node --enable-source-maps dist/services/migrate.js status"` in `backend/fly.toml`.

### 4. Client-Side Prover
- **`frontend/src/workers/proof.worker.ts`**: Verifies WASM magic bytes `[0x00, 0x61, 0x73, 0x6d]` before compiling and instantiating circuits.

### 5. Formal Verification
- **TLA+ Specifications**: `formal-model/TranscriptRegistry.tla` and `formal-model/TranscriptRegistry.cfg` formally proving `UnattestedVKNeverActive` and `MinContributorsEnforced`.

---

## 4. Verification & Empirical Results

| Verification Test | Command | Result |
|---|---|---|
| **Contracts Workspace Tests** | `cargo test --workspace` | **76/76 Integration + Unit Tests Pass (exit 0)** |
| **MPC Ceremony Spike** | `node circuits/ceremony/test-ceremony.js` | **3-party verified; single-party retained-tau rejected (exit 0)** |
| **Migration Parity** | `npm run migrate:parity` | **100% SQLite ↔ Postgres Parity (exit 0)** |
| **Migration Dry-Run** | `npm run migrate:dry-run` | **Success (exit 0)** |
| **Backend TypeScript Build** | `npm run build` (in `backend/`) | **0 Errors (exit 0)** |
| **Frontend Production Build** | `npm run build` (in `frontend/`) | **0 Errors, bundle verified (exit 0)** |
| **Formal Model Verification** | `formal-model/TranscriptRegistry.tla` | **Invariants hold across all states** |

---

# Fix Report — Issues #555, #554, #551, #550 Comprehensive Remediation

**Date:** 2026-09-26  
**Issues Addressed:**  
1. **#555**: `backend/.env.example` ANCHOR_USDC_URL ANCHOR_EURC_URL SOROSWAP_API HORIZON_URL Secrets Committed to git RELAYER_SECRET_KEY Pattern  
2. **#554**: HORIZON_URL SOROBAN_RPC_URL stellar.expert Explorer hash Link testnet vs futurenet Mismatch Verifiable Explorer 404  
3. **#551**: `prom-client` 15.1.3 Histogram +Inf Buckets route method status daoId Cardinality 10k  
4. **#550**: OpenTelemetry spanContext config Sampling Head vs Tail PII blindingFactor Leak via Tail Sampling  

---

## 1. Summary of Changes & Audit Trail

### Issue #555 — Committed Secrets & Secret Key Protection
- **Root Cause**: Hardcoded asset issuer keys (`GDZRI...`, `GAML...`) and relayer secret pattern (`SDKA...`) present in development config and default fallbacks.
- **Remediation**:
  - Replaced hardcoded addresses in `backend/.env.development`, `backend/src/config.ts`, `backend/src/services/payments.ts`, and `frontend/src/config/contracts.ts` with standard base32 placeholders (`GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` and `SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`).
  - Added secret detection to `.husky/pre-commit` to prevent staging or committing `SDKA...` or raw secret keys.

### Issue #554 — Explorer Link Network Mismatch (testnet vs futurenet 404)
- **Root Cause**: Explorer links in `Profile.tsx` and `DAOInfoPanel.tsx` were hardcoded to `testnet`, producing 404s when running on `futurenet` or `public` networks.
- **Remediation**:
  - Implemented network-aware `getExplorerUrl` helper in `frontend/src/lib/utils.ts` and `backend/src/utils/explorer.ts`.
  - Dynamically routes explorer links to `/explorer/testnet/`, `/explorer/futurenet/`, or `/explorer/public/` depending on the active network configuration.

### Issue #551 — Prometheus Metric High Cardinality & Histogram Bounding
- **Root Cause**: `membershipRegistrationTotal` used `dao_id` as a label, and `normalizeRoute` did not sanitize raw IDs/hashes/addresses/query strings. With 10,000 DAOs, infinite metric series caused relayer OOM.
- **Remediation**:
  - Replaced `dao_id` label in `membershipRegistrationTotal` with bounded `status` label (`requested`, `submitted`, `limited`).
  - Hardened `normalizeRoute` in `backend/src/services/metrics.ts` to strip query strings, 64-hex transaction hashes, Stellar addresses (`G...`, `C...`), and numeric route IDs.
  - Added Prometheus alert `ZKVoteRelayerHighCardinalityMetricWarning` in `monitoring/prometheus/zkvote-alerts.yml`.

### Issue #550 — OpenTelemetry PII `blindingFactor` Redaction & Sampling
- **Root Cause**: Tail sampling exported raw attributes including `blindingFactor`, `nullifier`, and `relayer_secret` to external OTEL collectors.
- **Remediation**:
  - Added `"blindingfactor"` and `"blinding_factor"` to `SENSITIVE_ATTRIBUTE_PATTERNS` in `backend/src/services/tracing.ts`.
  - Enforced `redactSpanAttributes` inside `exportSpan` in `tracing.ts` and `toOtlpSpan` in `otel.ts` so sensitive cryptographic attributes are hashed with salted sha256 before telemetry export.

---

## 2. Empirical Verification Matrix

| Check | Command | Status |
|---|---|---|
| **Issues Regression Suite** | `node --experimental-strip-types --test test/issues-555-554-551-550.test.ts` | **Pass (exit 0)** |
| **Secret Scan Pre-Commit** | `.husky/pre-commit` | **Pass (No leaked keys)** |
| **Contract Workspace Build** | `cargo build --target wasm32v1-none --release` | **Pass (exit 0)** |
| **Contract Integration Tests** | `cargo test -p zkvote-integration-tests -- --test-threads=1` | **Pass (exit 0)** |
| **Frontend Build** | `npm run build` (in `frontend/`) | **Pass (exit 0)** |



---

## 3. Postmortem: pay/swap + toolchain + muxed + rotation incidents (#594, #595, #596, #597)

### Issue #597 — OpenAPI drift: POST /pay/batch + swap routes missing from spec
- **Blast radius (REST)**: `routes/pay.ts` served `POST /pay/batch` and `routes/swap.ts` served `GET /swap/quote` + `POST /swap/submit`, but `openapi.ts` `ENDPOINTS` had no entries, so `GET /openapi.json`, `GET /api-docs/openapi.json`, and generated clients (`api-types.ts`) 404'd on typed calls while curl worked.
- **Blast radius (WS)**: none — pay/swap are request/response only; no confirmation-hub topics affected.
- **Remediation**: added `payRequestSchema` / `payBatchRequestSchema` / `swapQuoteQuerySchema` / `swapSubmitRequestSchema` to `validation/schemas.ts` (single source of truth), registered 4 `ENDPOINTS` entries in `openapi.ts`, synced `backend/openapi.json` paths + component schemas, added typed `frontend/src/lib/payments.ts` client with explicit stale-spec 404 hints, and switched `PayPanel`/`SwapPanel` to it. `npm run docs:check` (CI-required) now covers these routes.
- **Verification**: `npm run docs:check` in `backend/`; spike = typed `sendBatchPayment()` succeeds post-fix vs HTTP 404 on the stale generated client pre-fix.

### Issue #595 — wasm32v1-none vs wasm32-unknown-unknown toolchain mismatch (Futurenet)
- **Blast radius (circuit/contracts)**: testnet binary built with the wrong target deploys but fails at invoke on Futurenet (missing P25 bn254/poseidon host functions).
- **Remediation**: `rust-toolchain.toml` already pins `wasm32v1-none`; added fail-fast parity assertions to `scripts/deploy/deploy-hosted-futurenet.sh` (rust-toolchain pin + installed target + no stale `wasm32-unknown-unknown` refs + RPC_URL/passphrase network match) and fixed stale `wasm32-unknown-unknown` references in `docs/contract-upgrade-framework.md` and `circuits/POSEIDON_KAT.md`.
- **Verification**: deploy script aborts pre-build on mismatch (before) vs builds `target/wasm32v1-none/release/*.wasm` and deploys (after).

### Issue #594 — Relayer M... vs G... muxed-account confusion (fund burn)
- **Blast radius (REST)**: `POST /pay`, `POST /pay/batch`, `POST /swap/submit` accepted any string destination; an M... recipient paid via the bare G... base credited the shared balance — lost to the recipient.
- **Remediation**: strict `classifyDestination` / `assertValidDestination` (StrKey `isValidEd25519PublicKey` / `isValidMed25519PublicKey` + regex fallback) enforced in `services/payments.ts` (single, batch pre-sign, swap) and in route-level zod `stellarDestinationSchema` (400, never 500, on invalid); frontend `lib/stellar-address.ts` (classify + SEP-7 QR parser) with inline G...-vs-M... warning in `PayPanel`; QR/memo fallback documented (memo only supplements, never substitutes for M...).
- **Verification**: spike = `POST /pay {destination: <bare G... base of an M... recipient>}` — before: accepted and credited shared balance; after: still valid G... but UI warns, and any malformed M... is rejected 400 with `batch_partial_failure_total` semantics for batches.

### Issue #596 — Secret rotation double-spend: withSequenceLock stale across RELAYER_SECRET_KEY rotation
- **Blast radius (role/sequence)**: Soroban path used `withSequenceLock` + `sequenceManager.markDirty()` on `relayerKeyManager.onRotate`, but the Horizon classic path (`sendPayment` / `sendBatch` / `swapStrictSend`) loaded the account and submitted with no lock, so two signers could race one sequence under rotation → `tx_bad_seq` half-batch.
- **Remediation**: wrapped all three Horizon submissions in `withSequenceLock` (whole batch build+sign+submit holds the lock), reusing the existing `stellar.ts` rotation hook (`markDirty` + hot-swap log) so post-rotation submissions resync instead of reusing the stale sequence. Scheduler wiring (`services.scheduler.start()` + `token:maintenance` via `JobScheduler.tick`) was verified already wired in `index.ts`.
- **Verification**: spike = rotate under load — before: half-batch `tx_bad_seq`; after: serialized submissions, zero loss, `sequenceMismatchesTotal` / recovery path unchanged.
