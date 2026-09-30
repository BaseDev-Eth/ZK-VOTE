# CI/CD and Security Improvements (Issues #533, #534, #535)

## Summary

This document summarizes the improvements made to address security and CI/CD gaps identified in issues #533, #534, and #535.

## Issue #535: Git Leaks and Database Security

### Changes Made

1. **Enhanced .gitignore Files**
   - Added `*.db`, `*.db-wal`, `*.db-shm` patterns to all gitignore files
   - Added `temp/` and `dist/` directories to prevent build artifacts in git
   - Files updated: `.gitignore`, `backend/.gitignore`, `frontend/.gitignore`

2. **Pre-commit Hook Enhancement**
   - Added database file scanner that blocks commits containing `*.db` files
   - Existing secret scanner already blocks Stellar keys (`SDKA...`)
   - File: `.husky/pre-commit`

3. **Secret Hygiene Documentation**
   - Added comprehensive Section 6 to `SECURITY.md`
   - Documents never-commit rules for secrets and database files
   - Includes secret rotation procedures
   - Documents Litestream backup strategy
   - Provides git-filter-repo commands for history purging

4. **Backup Strategy**
   - Existing `backend/litestream.yml` already configured for S3-compatible backup
   - Documentation now emphasizes using Litestream instead of git for backups
   - Covers WAL-based continuous replication

### Verification

```bash
# Test pre-commit hook blocks database files
echo "test" > test.db
git add test.db
git commit -m "test"  # Should fail with database file error

# Verify gitignore patterns
echo "test" > backend/data/test.db
git status  # Should not show test.db

# Run security check
cd backend
npm run config:security
```

## Issue #534: Type Generation Drift

### Changes Made

1. **CI Type Generation Check**
   - Added migration parity check to `.github/workflows/ci.yml`
   - Generates types from migrations (not live database)
   - Fails CI if `db-types.ts` is out of sync with migrations
   - Process: `migrate:up` → `db:generate-types` → `git diff --exit-code`

2. **Documentation**
   - Updated `SECURITY.md` with type generation best practices
   - Emphasizes generating from migrations, not runtime database
   - Prevents drift between schema and type definitions

### How It Works

The CI now:

1. Runs migrations to create a fresh database from migration files
2. Generates TypeScript types using `kysely-codegen`
3. Compares generated types with committed `src/generated/db-types.ts`
4. Fails if types are out of sync

This ensures:

- Type definitions always match the migration schema
- Database file is never needed for type generation
- Prevents `VoteMode` enum drift and similar issues
- Catches `bigint` vs `number` mismatches early

### Usage

```bash
# Developer workflow to regenerate types
cd backend
npm run migrate:up
npm run db:generate-types
git add src/generated/db-types.ts
git commit -m "Update db types from migrations"
```

## Issue #533: CI Coverage Gaps

### Changes Made

1. **Integration Tests**
   - CI already runs integration tests explicitly: `cargo test -p zkvote-integration-tests`
   - Tests include: Poseidon KAT, vote modes, deadlines, circuit upgrades, reentrancy

2. **Nightly Stress Tests**
   - Created `.github/workflows/nightly-stress.yml`
   - Runs ignored stress tests: `cargo test --test stress -- --ignored`
   - Runs daily at 2 AM UTC
   - 2-hour timeout for comprehensive load testing
   - Includes backend database benchmark

3. **Circuit Verification**
   - Existing `circuit-kat` and `circuit-e2e` jobs already run Poseidon KAT and E2E tests
   - Tests use hermetic `circom 2.1.8` and `snarkjs 0.7.5`
   - Version pinned via `.circomversion` file

4. **Configuration Security Check**
   - Created `backend/scripts/check-config-security.ts`
   - Validates CORS, secret patterns, gitignore, pre-commit hooks
   - Added `npm run config:security` script
   - Integrated into CI workflow

5. **Formal Model Verification**
   - Existing `.github/workflows/formal-model.yml` already runs TLA+ model checking
   - Uses TLC and Apalache for verification
   - Triggered on formal-model changes

### CI Jobs Summary

**On Every PR/Push:**

- Unit tests (workspace, excluding integration)
- Integration tests (explicit `-p zkvote-integration-tests`)
- Groth16 edge case corpus tests
- Frontend tests with coverage
- Backend tests with JSDoc validation
- Poseidon KAT test (circuit-kat job)
- E2E ZK proof test (circuit-e2e job)
- OpenAPI spec parity check
- Config schema sync check
- **NEW**: Configuration security check
- **NEW**: Migration parity check for db-types
- Formal model TLC check (on formal-model changes)

**Nightly (2 AM UTC):**

- Stress tests (ignored tests with `--nocapture`)
- Backend database benchmark
- Load testing

### What This Prevents

1. **Prevents CORS Regression**: Config security check ensures CORS is not set to wildcard
2. **Prevents Secret Leaks**: Pre-commit hook + config check prevent secret commits
3. **Prevents DB File Commits**: Pre-commit hook + gitignore + config check
4. **Prevents Type Drift**: Migration parity check catches VoteMode enum drift, etc.
5. **Prevents Reentrancy**: Integration tests include reentrancy scenarios
6. **Prevents Performance Regression**: Nightly stress tests catch capacity issues
7. **Prevents OpenAPI Drift**: Existing docs:check ensures API.md and openapi.json stay in sync

## Testing the Changes

### Local Testing

```bash
# Test pre-commit hook
echo "test" > test.db
git add test.db
git commit -m "test"  # Should block

# Test config security check
cd backend
npm run config:security  # Should pass

# Test type generation check
npm run migrate:up
npm run db:generate-types
git diff src/generated/db-types.ts  # Should be empty

# Test integration suite
cd ..
cargo test -p zkvote-integration-tests

# Test stress tests (manual)
cargo test --test stress -- --ignored --nocapture
```

### CI Testing

All checks run automatically on PR. To verify:

1. Create a test PR
2. Verify all CI jobs pass
3. Check that new jobs appear:
   - "Check configuration security" in backend job
   - "Check migration parity with db-types" in backend job
4. For nightly tests, wait for next scheduled run or trigger manually via GitHub Actions UI

## Migration Notes

### For Maintainers

1. **Type Generation**: Always regenerate types after schema changes:

   ```bash
   cd backend
   npm run migrate:up
   npm run db:generate-types
   ```

2. **Database Files**: Never commit `*.db` files. If accidentally committed, use:

   ```bash
   git filter-repo --path backend/data/zkvote.db --invert-paths
   ```

3. **Secret Rotation**: If secrets are leaked, immediately:
   - Rotate keys using `npm run rotate-tokens`
   - Purge git history
   - Revoke compromised keys

4. **Stress Tests**: Run locally before major releases:
   ```bash
   cargo test --test stress -- --ignored --nocapture --test-threads=1
   ```

### For Contributors

1. Pre-commit hook will block dangerous commits
2. CI will catch configuration drift
3. Run `npm run config:security` before pushing
4. Regenerate types if you change migrations

## Future Improvements

1. **Automated Secret Scanning**: Consider integrating git-secrets or TruffleHog
2. **Dependency Scanning**: Add Dependabot alerts for vulnerable dependencies
3. **Performance Benchmarking**: Track stress test metrics over time
4. **Configuration Validation**: Extend config:security to check more patterns
5. **Database Migration Testing**: Add migration rollback tests

## References

- Issue #533: https://github.com/ZK-VOTE/ZK-VOTE/issues/533
- Issue #534: https://github.com/ZK-VOTE/ZK-VOTE/issues/534
- Issue #535: https://github.com/ZK-VOTE/ZK-VOTE/issues/535
- SECURITY.md: Secret hygiene best practices
- .github/workflows/ci.yml: Main CI configuration
- .github/workflows/nightly-stress.yml: Nightly stress testing
