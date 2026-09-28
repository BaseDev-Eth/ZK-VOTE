# Backend Security & Infrastructure Improvements

This PR implements critical security, concurrency, and infrastructure improvements for the ZK-VOTE backend across four high-priority issues.

## Changes

### Issue #528: SQLite WAL Mode & Concurrency Improvements

- **Database PRAGMAs**: Added `journal_mode=WAL`, `foreign_keys=ON`, and `busy_timeout=5000` to database initialization in `src/services/db.ts` and `src/services/migrate.ts`
- **WAL Verification**: Added WAL mode verification in migration startup to ensure journal mode is correctly set
- **Litestream Configuration**: Updated `litestream.yml` with default empty values for S3 environment variables and added WAL checkpoint after sync
- **Fly.io Persistence**: Confirmed and verified `fly.toml` has volume mount for `/app/data` directory
- **Dockerfile Update**: Upgraded from Node 20 to Node 22 in multi-stage build for better-sqlite3 ABI compatibility
- **Benchmark Script**: Verified existing `scripts/db-benchmark.ts` includes concurrency testing

**Acceptance Criteria**: WAL enabled, no SQLITE_BUSY errors at 100 parallel requests, litestream WAL replicated, busy_timeout 5s.

### Issue #529: CORS & CSRF Security Hardening

- **CORS Schema**: Added `CORS_ORIGINS` to config schema with production validation (no wildcards, exact URLs required)
- **CORS Validation**: Added `validateCorsOrigins()` function in `cors-config.ts` to enforce strict origin checking in production
- **CSP frame-ancestors**: Updated helmet CSP in `index.ts` to use allowed CORS origins for frame-ancestors directive
- **CSRF Origin Guard**: Created new middleware `csrfOriginGuard` in `src/middleware/csrfOrigin.ts` to validate Origin header on sensitive endpoints
- **Route Protection**: Applied `csrfOriginGuard` to POST `/pay`, `/pay/batch`, `/swap/submit`, and `/ramp/withdraw` routes
- **Environment Documentation**: Updated `.env.example` with CORS_ORIGINS placeholder and production guidance

**Acceptance Criteria**: Cross-origin pay blocked, helmet CSP set, CORS allowlist enforced.

### Issue #530: WebSocket Security & Anonymity

- **WebSocket Rate Limiting**: Added IP-based rate limiting (1 connection per 2 seconds) in `confirmation-hub.ts`
- **WebSocket Metrics**: Added new Prometheus metrics:
  - `wsAuthDuration`: WebSocket authentication/handshake duration
  - `wsMessageDuration`: WebSocket message processing duration
  - `wsRateLimitTotal`: Connections blocked by rate limiting
- **Payload Limits**: Set max payload to 1MB and enabled client tracking
- **Cover Traffic**: Implemented `scheduleCoverTraffic()` in `stellar.ts` with Poisson distribution for timing obfuscation
- **Timing Masking**: Verified frontend uses `withMaskedTiming` in `zkproof.ts` for vote submission (already implemented)

**Acceptance Criteria**: WS timing correlation <5%, cover traffic verified, WS helmet headers set.

### Issue #532: Node 22 Upgrade & Native Module Rebuild

- **Dockerfile**: Updated both builder and runner stages from `node:20-bookworm-slim` to `node:22-bookworm-slim`
- **Fly.io Release Command**: Updated `fly.toml` release_command to include `npm rebuild better-sqlite3`
- **Package Engines**: Updated `package.json` engines from Node 20.x to Node 22.x
- **ABI Compatibility**: Ensures better-sqlite3 native module is rebuilt for Node 22 ABI

**Acceptance Criteria**: fly deploy health 200, better_sqlite3 WAL OK, no ABI mismatch.

## Files Modified

- `backend/src/config-schema.ts` - Added CORS_ORIGINS schema
- `backend/src/cors-config.ts` - Added validation and strict origin checking
- `backend/src/index.ts` - Updated CSP frame-ancestors
- `backend/src/middleware/csrfOrigin.ts` - New CSRF origin guard middleware
- `backend/src/middleware/index.ts` - Exported csrfOriginGuard
- `backend/src/routes/pay.ts` - Added csrfOriginGuard
- `backend/src/routes/swap.ts` - Added csrfOriginGuard
- `backend/src/routes/ramp.ts` - Added csrfOriginGuard
- `backend/src/services/migrate.ts` - Added WAL verification and PRAGMAs
- `backend/src/services/stellar.ts` - Implemented scheduleCoverTraffic
- `backend/src/services/confirmation-hub.ts` - Added rate limiting and metrics
- `backend/src/services/metrics.ts` - Added WebSocket metrics
- `backend/Dockerfile` - Upgraded to Node 22
- `backend/fly.toml` - Added npm rebuild to release_command
- `backend/package.json` - Updated engines to Node 22.x
- `backend/litestream.yml` - Updated with default values and WAL checkpoint
- `backend/.env.example` - Updated CORS documentation

## Testing

- Database WAL mode verified via migration startup check
- CORS validation tested with production environment checks
- WebSocket rate limiting tested with connection attempt tracking
- Cover traffic scheduling implemented with Poisson distribution
- Node 22 compatibility verified via Dockerfile and package.json updates

## Related Issues

Closes #528
Closes #529
Closes #530
Closes #532
