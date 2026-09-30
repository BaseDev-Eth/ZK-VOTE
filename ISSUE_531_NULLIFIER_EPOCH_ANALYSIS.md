# Issue #531: Nullifier Collision Risk - Epoch Analysis

## Problem Statement

The current nullifier calculation in `circuits/vote_template.circom` is:

```circom
nullifier = Poseidon(secret, daoId, proposalId)
```

This creates a collision risk if:

1. A DAO with `daoId=N` is deleted
2. A new DAO is created and reuses `daoId=N`
3. The same voter uses the same `secret` to vote on a proposal in both DAOs

The nullifier would be identical, causing either:

- Double voting (if old nullifier is still valid)
- Vote rejection (if nullifier is marked as used)

## Root Cause

The current design assumes `daoId` values are monotonically increasing and never reused. However:

- The `dao-registry` contract uses `u64` auto-increment for `dao_id`
- No tombstone mechanism exists to prevent `dao_id` reuse after deletion
- After ~2^64 DAOs (or if deletion/recreation cycles), `dao_id` could wrap or be reused

## Proposed Solution: Add Epoch to Nullifier

### Circuit Changes

Modify `circuits/vote_template.circom` to include an epoch parameter:

```circom
// OLD
component nullifierHasher = Poseidon(3);
nullifierHasher.inputs[0] <== secret;
nullifierHasher.inputs[1] <== daoId;
nullifierHasher.inputs[2] <== proposalId;

// NEW
component nullifierHasher = Poseidon(4);
nullifierHasher.inputs[0] <== secret;
nullifierHasher.inputs[1] <== daoId;
nullifierHasher.inputs[2] <== epoch;      // NEW
nullifierHasher.inputs[3] <== proposalId;
```

Update public signals:

```circom
// OLD
signal input nullifier;
signal input daoId;
signal input proposalId;

// NEW
signal input nullifier;
signal input daoId;
signal input epoch;      // NEW
signal input proposalId;
```

### Contract Changes

**dao-registry**:

- Add `epoch: u32` field to DAO storage
- Increment `epoch` when a DAO is recreated with the same `daoId`
- Store tombstones for deleted DAOs in `Map<u64, u32>` (daoId → final epoch)

**voting**:

- Update nullifier storage: `Map<(daoId, epoch, nullifier), bool>`
- Include `epoch` in `vote()` function parameters
- Validate epoch matches current DAO epoch

### Backend Changes

**Migrations** (`backend/src/migrations/`):

- Add `epoch INTEGER NOT NULL DEFAULT 0` column to `daos` table
- Add `epoch INTEGER NOT NULL DEFAULT 0` column to `proposals` table
- Add `epoch INTEGER NOT NULL DEFAULT 0` column to `votes` table
- Migrate existing nullifiers to `epoch 0`

**Services** (`backend/src/services/`):

- Update DAO creation/deletion logic to manage epochs
- Update vote submission to include epoch
- Update nullifier checks to scope by `(daoId, epoch, nullifier)`

### Frontend Changes

**zkproof.ts** (`frontend/src/lib/zkproof.ts`):

- Include `epoch` in witness generation
- Fetch current DAO epoch from contract before generating proof
- Pass epoch as public signal

### Formal Model Changes

**TLA+ Model** (`formal-model/ZKVote.tla`):

- Add `epoch` to DAO state
- Model epoch incrementation on DAO deletion/recreation
- Verify nullifier uniqueness with epoch scoping

## Breaking Changes

⚠️ **This is a breaking change that requires:**

1. **Circuit Recompilation**: New R1CS, WASM, and verification keys
2. **Trusted Setup**: New Phase 2 MPC ceremony for production circuits
3. **Contract Migration**: Deploy new contract versions with epoch support
4. **Database Migration**: Add epoch columns and migrate existing data
5. **Frontend Updates**: Update proof generation to include epoch
6. **Backward Incompatibility**: Old proofs will not verify with new circuits

## Migration Strategy

### Phase 1: Preparation (Non-Breaking)

1. Add epoch columns to database with `DEFAULT 0`
2. Update backend services to read/write epoch (but don't enforce yet)
3. Add epoch field to API responses (for forward compatibility)

### Phase 2: Circuit Update (Breaking)

1. Recompile circuits with epoch parameter
2. Run Phase 2 MPC ceremony for new circuits
3. Register new verification keys in `CircuitRegistry`

### Phase 3: Contract Deployment (Breaking)

1. Deploy new `dao-registry` with epoch support
2. Deploy new `voting` contract with epoch-scoped nullifiers
3. Migrate existing DAO data (set all to `epoch 0`)

### Phase 4: Frontend Rollout

1. Update frontend to fetch epoch before proof generation
2. Include epoch in witness
3. Test with new circuits and contracts

### Phase 5: Cleanup

1. Deprecate old contracts
2. Archive old verification keys
3. Update documentation

## Testing Requirements

### Unit Tests

- Circuit tests with epoch variations
- Contract tests for epoch incrementation
- Backend tests for epoch-scoped nullifiers

### Integration Tests

- End-to-end vote flow with epoch
- DAO deletion and recreation scenarios
- Nullifier collision prevention

### Regression Tests

- Existing DAOs at `epoch 0` continue to work
- Migration from old to new system
- Backward compatibility for read-only operations

## Timeline Estimate

- Circuit changes: 2-3 days
- Contract changes: 3-4 days
- Backend changes: 2-3 days
- Frontend changes: 1-2 days
- Testing & validation: 5-7 days
- MPC ceremony: 3-5 days (coordinate contributors)
- Documentation: 1-2 days

**Total: ~3-4 weeks** for careful implementation and testing

## Security Considerations

1. **Epoch Overflow**: Use `u32` (4 billion epochs) - sufficient for any realistic DAO lifecycle
2. **Tombstone Storage**: Store deleted DAO epochs to prevent accidental reuse
3. **Migration Atomicity**: Ensure database and contract state stay in sync during migration
4. **Proof Verification**: Old proofs must be explicitly rejected (not silently fail)

## Recommendation

This issue requires **careful planning and coordination** due to its cryptographic and breaking nature. The fix is necessary for long-term security but should be:

1. **Thoroughly Tested**: Run extensive test suite on testnet
2. **Well Communicated**: Announce breaking changes to users and integrators
3. **Incrementally Deployed**: Use multi-phase rollout to minimize disruption
4. **Formally Verified**: Update TLA+ model and verify epoch properties

## Alternative: Short-term Mitigation

Until the full epoch solution is implemented, consider:

1. **Document Limitation**: Clearly state in docs that DAO IDs should not be reused
2. **Prevent Deletion**: Disable or restrict DAO deletion in contracts
3. **Monitoring**: Alert if nullifier collisions are detected
4. **Reserve ID Space**: Use large random `daoId` values to minimize collision probability

## References

- Issue #531: https://github.com/ZK-VOTE/ZK-VOTE/issues/531
- THREAT_MODEL.md: Nullifier uniqueness assumptions
- circuits/vote_template.circom: Current nullifier calculation
- contracts/dao-registry: DAO ID management
- contracts/voting: Nullifier storage
