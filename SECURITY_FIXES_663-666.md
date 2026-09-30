# Security and Infrastructure Fixes (Issues #663-666)

This document summarizes the fixes applied to address critical security and infrastructure issues identified in the ZK-VOTE repository.

## Issue #663: Supply Chain Security Improvements

### Problems Identified

- No `--locked` flag on Cargo commands, allowing dependency drift
- Security audits could never fail CI builds (`|| true` swallowed all errors)
- No Cargo ecosystem in Dependabot configuration
- Unverified binary downloads (stellar-cli, circom) without checksums
- Moving git refs in circom installation and Docker images
- Invalid SHA256 placeholder in circuits/Dockerfile
- Pre-commit hook regex missed actual committed Stellar secrets
- Mutable Docker image tags (`latest`, `stable`)

### Fixes Applied

#### Build Security

- **Added `--locked` flag to all Cargo commands**: Ensures exact dependency versions from Cargo.lock are used
  - `cargo build --locked`
  - `cargo test --locked`
  - `cargo clippy --locked`
  - `cargo doc --locked`

#### CI Hardening

- **Removed `|| true` from audit commands**: Security audits now fail builds on vulnerabilities
  - `cargo audit` (was `cargo audit || true`)
  - `npm audit --audit-level=high` (was `npm audit --audit-level=high || true`)
  - `cargo install cargo-audit --locked` (was `cargo install cargo-audit || true`)

#### Dependency Management

- **Added Cargo to Dependabot** (`.github/dependabot.yml`):
  ```yaml
  - package-ecosystem: cargo
    directory: /
    schedule:
      interval: weekly
  ```

#### Binary Verification

- **Added SHA256 checksums** for downloaded binaries:
  - stellar-cli v21.0.0 download verification
  - circom v2.1.8 download verification
  - tla2tools.jar verification
- **Fixed circuits/Dockerfile**: Corrected invalid 61-character SHA256 placeholder to proper hash format

#### Toolchain Pinning

- **Pinned circom version** in bridge workflow:
  - Changed from `cargo install --git https://github.com/iden3/circom.git`
  - To `cargo install --locked --git https://github.com/iden3/circom.git --tag v2.1.8`
- **Pinned Rust toolchain** in bridge workflow:
  - Changed from `dtolnay/rust-toolchain@stable`
  - To `dtolnay/rust-toolchain@master` with explicit version `1.91.1`
- **Pinned Docker images**:
  - Apalache: `latest` → `0.44.11`

#### Secret Detection

- **Enhanced pre-commit hook** (`.husky/pre-commit`):
  - Now catches actual Stellar secret patterns: `S[A-Z2-7]{55}`
  - Excludes only legitimate placeholders: `SXXXXXXX`, `REPLACE_ME`, `placeholder`, `example`
  - Previous regex only matched `SDKA...` and `RELAYER_SECRET_KEY=S...` patterns

---

## Issue #664: TLA+ Formal Verification Improvements

### Problems Identified

- TLC model checker failures were suppressed (`|| true`)
- Apalache type checker failures were suppressed (`|| true`)
- Lean proof files (BN254_Groth16.lean, Proofs.lean) were never compiled
- No verification that formal models could actually fail
- Mutable Docker tags (`latest`) for Apalache
- No checksum verification for tla2tools.jar

### Fixes Applied

#### Model Checker Enforcement

- **Removed `|| true` from TLC** (`.github/workflows/formal-model.yml`):

  ```yaml
  # Before:
  java -cp tla2tools.jar tlc2.TLC ... || echo "TLC check completed with warnings"

  # After:
  java -cp tla2tools.jar tlc2.TLC ...
  ```

  Now invariant violations will fail the build

- **Removed `|| true` from Apalache**:

  ```yaml
  # Before:
  docker run ... apalache typecheck ... || echo "Apalache typecheck completed with warnings"

  # After:
  docker run ... apalache:0.44.11 typecheck ...
  ```

#### Lean Proof Verification

- **Added Lean 4 compilation job**:
  ```yaml
  lean-compile:
    name: Lean Proofs Compilation
    steps:
      - Install Lean 4 toolchain
      - Compile BN254_Groth16.lean
      - Compile Proofs.lean
      - Fail build if compilation errors occur
  ```

#### Verification Hardening

- **Added SHA256 verification** for tla2tools.jar
- **Pinned Apalache version** to `0.44.11` (was `latest`)
- **Explicit failure on errors** - no more silent passes

---

## Issue #665: Unbounded Prometheus Metrics Cardinality

### Problems Identified

- `normalizeRoute()` didn't handle `vote`, `threshold`, or `randomness` routes
- UUID parameters (e.g., `/vote/status/:jobId`) created unbounded series
- Relayer key metrics exposed full public keys in labels
- Each unique route parameter created permanent metric series
- No upper bound on series count → eventual OOM

### Fixes Applied

#### Route Normalization

Enhanced `normalizeRoute()` in `backend/src/services/metrics.ts`:

```typescript
// Added UUID pattern matching
.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")

// Added missing route patterns
.replace(
  /\/(dao|proposal|...|vote|threshold|randomness)\/[^/]+/gi,
  "/$1/:param",
)

// Added threshold to multi-param patterns
.replace(
  /\/(proposal|nullifier|...|threshold)\/[^/]+\/[^/]+/gi,
  "/$1/:param/:id2",
)
```

#### Sensitive Label Removal

Removed `public_key` labels from relayer metrics:

```typescript
// Before:
export const relayerKeyBalance = new Gauge({
  labelNames: ["key_id", "public_key", "role"],
});

// After:
export const relayerKeyBalance = new Gauge({
  labelNames: ["key_id", "role"],
});
```

Also applied to:

- `relayerKeyAgeSeconds`
- `relayerKeyTransactionsTotal`

#### Impact

- Prevents `/vote/status/<uuid>` from creating ~2.4M series per 200k requests
- Prevents `/threshold/state/:id/:id` cardinality explosion
- Prevents `/randomness/ordering/:daoId` cardinality explosion
- Hides relayer signing keys from unauthenticated `/metrics` endpoint

---

## Issue #666: Fake Remediation Success Responses

### Problems Identified

- `POST /remediation/action` returned `201 { success: true, immutable: true }`
- No actual on-chain operations were performed
- Audit trail was misleading during incidents
- Operators would believe actions were executed when they weren't

### Fixes Applied

#### Honest Response Status

Changed `backend/src/routes/remediation.ts`:

```typescript
// Before:
res.status(201).json({
  success: true,
  remediationId: id,
  record: { ... immutable: true }
});

// After:
res.status(501).json({
  error: "not_implemented",
  message: "Remediation actions are not implemented...",
  simulated: true,
  remediationId: id,
  record: { ... immutable: false }
});
```

#### Changes Made

- **Status code**: `201 Created` → `501 Not Implemented`
- **Removed**: `success: true`
- **Added**: `error: "not_implemented"`
- **Added**: `simulated: true` flag
- **Changed**: `immutable: true` → `immutable: false`
- **Added**: Explicit error message explaining limitation

#### Impact

- Operators no longer receive false confirmation
- Audit trail no longer claims actions were executed
- Clear indication that endpoint is simulated
- Forces explicit acknowledgment that real implementation is needed

---

## Additional Security Improvements

### Deployment Script Hardening

#### deploy-hosted-futurenet.sh

- Added security warning header about key reuse
- Explicit warnings when using same key for multiple roles
- Better error messages for missing or invalid keys
- Documented that `REPLACE_ME_*` placeholders pass validation

#### redeploy-after-reset.sh

- Changed `set -e` to `set -euo pipefail` for stricter error handling
- Added validation for contract ID format before production deployment
- Created backup of `.env.production` before modification
- Added explicit error messages with `fail()` function
- Prevented silent failures in `rsync` and `docker compose` commands
- Added security warning header about force-push to production

### Secret Exposure Prevention

Fixed `scripts/test/e2e-zkproof.sh`:

```bash
# Before:
echo "   Secret: ${SECRET:0:20}..."
echo "   Salt: ${SALT:0:20}..."

# After:
echo "   Secret: [REDACTED]"
echo "   Salt: [REDACTED]"
```

This prevents leaking ~95 bits of Stellar secret seed entropy in CI logs.

---

## Verification Checklist

### Issue #663 (Supply Chain)

- [x] All `cargo` commands use `--locked`
- [x] Security audits can fail builds
- [x] Cargo added to Dependabot
- [x] Binary downloads have SHA256 verification
- [x] Circom pinned to v2.1.8
- [x] Rust toolchain pinned to 1.91.1
- [x] Pre-commit hook catches leaked Stellar secrets
- [x] Docker images use pinned versions

### Issue #664 (Formal Verification)

- [x] TLC failures fail the build
- [x] Apalache failures fail the build
- [x] Lean proofs are compiled in CI
- [x] Apalache pinned to v0.44.11
- [x] tla2tools.jar has checksum verification

### Issue #665 (Metrics Cardinality)

- [x] `vote`, `threshold`, `randomness` normalized
- [x] UUID pattern matching added
- [x] Public keys removed from relayer metrics
- [x] `/vote/status/:jobId` bounded
- [x] `/threshold/state/:id/:id` bounded

### Issue #666 (Remediation)

- [x] Returns 501 Not Implemented
- [x] No fake `success: true`
- [x] `simulated: true` flag present
- [x] `immutable: false` for simulated actions
- [x] Explicit error message

---

## Remaining Considerations

### Not Addressed in This PR

1. **GitHub Actions SHA pinning**: Actions still use tags (`@v4`) instead of commit SHAs
   - Would require pinning ~50+ action references
   - Recommend separate PR with automated tooling (e.g., dependabot)

2. **Lean proof correctness**: CI now _compiles_ Lean files but doesn't verify correctness
   - Requires subject-matter expert review
   - Recommend engagement with formal methods team

3. **TLA+ spec completeness**: Structural issues remain (I1 not temporal, I5 contradicted, etc.)
   - Requires domain expert to rewrite invariants
   - Bridge model still missing from formal-model/

4. **Frontend Dockerfile `npm install`**: Still uses `npm install` instead of `npm ci`
   - Lower priority than contract build reproducibility
   - Recommend separate PR

### Follow-up Actions

1. Review and update TLA+ invariants (requires formal methods expertise)
2. Add bridge contracts to formal model scope
3. Consider SHA-pinning GitHub Actions (can use dependabot for automation)
4. Validate Lean proofs for correctness (requires cryptography expertise)
5. Implement real remediation actions or remove endpoint entirely

---

## Testing Recommendations

### Verify Supply Chain Fixes

```bash
# Test cargo audit fails on vulnerabilities
cargo audit

# Test locked dependencies
rm Cargo.lock && cargo build --locked  # Should fail

# Test pre-commit hook
echo 'SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF' >> test.txt
git add test.txt && git commit -m "test"  # Should be blocked
```

### Verify Metrics Fixes

```bash
# Test route normalization
curl http://localhost:3001/vote/status/550e8400-e29b-41d4-a716-446655440000
curl http://localhost:3001/metrics | grep 'route="/vote/status/:uuid"'

# Verify no public keys in metrics
curl http://localhost:3001/metrics | grep -i 'public_key'  # Should find nothing
```

### Verify Remediation Fix

```bash
# Test remediation endpoint
curl -X POST http://localhost:3001/remediation/action \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"action":"emergency_pause","target":"1","reason":"test"}'
# Should return 501 with simulated: true
```

---

## References

- Issue #663: https://github.com/ZK-VOTE/ZK-VOTE/issues/663
- Issue #664: https://github.com/ZK-VOTE/ZK-VOTE/issues/664
- Issue #665: https://github.com/ZK-VOTE/ZK-VOTE/issues/665
- Issue #666: https://github.com/ZK-VOTE/ZK-VOTE/issues/666
