# Security Policy and Cryptographic Architecture

## 1. Vulnerability Reporting

If you discover a security vulnerability within ZKVote, please report it privately to security@zkvote.io or through GitHub Private Vulnerability Reporting. Do NOT open public issues for zero-day vulnerabilities.

---

## 2. Groth16 MPC Phase 2 Ceremony & Toxic Waste Elimination

### The Single-Party Setup Risk

Groth16 zk-SNARKs rely on structured reference strings (SRS) generated during a multi-stage trusted setup. The setup decomposes into:

1. **Phase 1 (Powers of Tau)**: Universal reference string generation independent of specific circuits.
2. **Phase 2 (Circuit-Specific Setup)**: Generation of circuit-specific evaluation keys ($A, B, C$) evaluated at secret points $\tau, \alpha, \beta, \gamma, \delta$.

If a single party evaluates the Phase 2 setup on a single machine ("single-laptop setup"), retention of the secret trapdoors $\tau$ ("toxic waste") allows that party to forge valid Groth16 proofs for arbitrary statements—such as proving membership in a 262,144-leaf Merkle tree without possessing a valid private key or commitment.

### Multi-Party Ceremony Requirement

To eliminate this risk, ZKVote mandates an authenticated multi-party computation (MPC) ceremony for all production circuits:

- **Minimum Contributors**: $\ge 3$ distinct independent contributors (`MIN_MPC_CONTRIBUTORS = 3`).
- **Cryptographic Hash Chain**: Each contributor receives contribution $i-1$, verifies its parameters, injects fresh cryptographically secure entropy, and outputs contribution $i$. The file hash of contribution $i$ is linked to contribution $i-1$.
- **Random Public Beacon**: The final parameters are randomized with an unpredictable public beacon (e.g. Bitcoin block hash or drand randomness beacon) with 10 iterations of repeated SHA-256 hashing.
- **Transcript Registry Verification**: The transcript containing contributor identity, contribution hashes, and beacon parameters is attested and verified on-chain.

---

## 3. On-Chain `TranscriptRegistry` Gating

The `Voting` and `CircuitRegistry` contracts enforce cryptographic ceremony attestation before any verification key (VK) can be activated:

```
[Off-Chain MPC Ceremony]
Alice (c1) -> Bob (c2) -> Charlie (c3) -> Random Beacon -> Final zkey & VK
                                                                │
                                                                ▼
                                                    [Transcript Registry]
                                                    - verify_attestation()
                                                    - contributors >= 3
                                                    - beacon hash validated
                                                                │
                                                                ▼
                                                        is_vk_attested = true
                                                                │
                                                                ▼
                                                        [Voting Contract]
                                                        - set_vk() requires attestation
                                                        - snapshotted per proposal
```

### Verification Invariants

1. **`UnattestedVKNeverActive`**: No VK can be used to initialize or vote on a proposal unless it has been attested in `TranscriptRegistry`.
2. **`MinContributorsEnforced`**: Transcripts with fewer than 3 independent contributors cannot be attested.
3. **`ProposalVKSnapshot`**: When a proposal is created, the VK hash is immutable for that proposal's lifecycle, preventing mid-election substitution.

---

## 4. Web Worker & Client-Side Proof Hardening

- **WASM Magic Header Check**: Prior to instantiation, the proving Web Worker (`proof.worker.ts`) inspects the initial 4 bytes of all compiled WASM artifacts to ensure `0x00, 0x61, 0x73, 0x6d` (`\0asm`). Corrupted or modified payloads fail immediately.
- **BN254 Scalar Field Bounds**: All public signals ($nullifier, root, dao\_id, proposal\_id, vote\_choice$) are verified to reside strictly within the BN254 scalar field $r < 21888242871839275222246405745257275088548364400416034343698204186575808495617$.

---

## 5. Multi-Tenant Relayer Security

- **Strict Tenant Isolation**: All database operations partition data with explicit `tenant_id` scopes (`AuditLog`, `Events`, `TransactionLog`, `PaymentJobs`).
- **Cross-Tenant Guardrails**: Middleware rejects cross-tenant requests and increments `zkvote_cross_tenant_denial_total`.
- **Reconciliation Engine**: Periodic reconciliation compares SQLite relayer cache against on-chain Soroban ledger events. Any divergence increments `zkvote_reconciliation_mismatch_total` and triggers automated alerts.
- **Rate-Limiting & Memory Protection**: In-memory stores are monitored via Prometheus gauges (`zkvote_rate_limit_store_size`, `zkvote_session_store_size`), and stale sessions are pruned by `JobScheduler`.

---

## 6. Secret Hygiene & Database Security (Issue #535)

### Never Commit Secrets or Database Files

**Critical Rule**: Never commit the following to version control:

- **Secret Keys**: `RELAYER_SECRET_KEY`, Stellar seed keys (`SDKA...`), API tokens, or private keys
- **Database Files**: `*.db`, `*.db-wal`, `*.db-shm` files containing production or development data
- **Backup Keys**: Files in `backend/data/backup-keys/` or `backend/data/backups/`
- **Environment Files**: `.env` files with real credentials (use `.env.example` templates only)

### Pre-Commit Hook Protection

The `.husky/pre-commit` hook automatically blocks commits containing:

1. Secret key patterns matching Stellar seeds (`SDKA[A-Z0-9]{52}`)
2. Database files (`*.db`, `*.db-wal`, `*.db-shm`)
3. Hardcoded `RELAYER_SECRET_KEY` values

### Database Backup Strategy

Use **Litestream** for continuous WAL-based replication to S3-compatible storage:

```yaml
# backend/litestream.yml
dbs:
  - path: ./data/zkvote.db
    replicas:
      - type: s3
        bucket: ${LITESTREAM_S3_BUCKET}
        sync-interval: 1s
        retention: 720h
        snapshot-interval: 24h
```

**Never commit `data/zkvote.db` to git.** Use Litestream or database dump scripts for backups.

### Secret Key Rotation

If secrets are accidentally committed:

1. **Immediate Rotation**: Rotate all exposed keys using `backend/src/rotate-tokens.sh`
2. **History Purge**: Use `git-filter-repo` to remove secrets from git history:
   ```bash
   git filter-repo --path backend/data/zkvote.db --invert-paths
   git filter-repo --replace-text <(echo "SDKA[REDACTED-SECRET-KEY]")
   ```
3. **Force Push**: After purging, force-push to remote (coordinate with team)
4. **Invalidate Old Keys**: Revoke/invalidate the compromised keys on Stellar network if necessary

### Type Generation from Migrations (Not Database)

Generate `db-types.ts` from migration files, not from live database:

```bash
# Generate fresh database from migrations for type extraction
npm run migrate:up
npm run db:generate-types
```

This ensures type definitions match the migration schema, not runtime data.
