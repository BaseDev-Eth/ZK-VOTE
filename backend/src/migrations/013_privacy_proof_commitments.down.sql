-- ============================================
-- Migration 013 rollback
-- ============================================

DROP INDEX IF EXISTS idx_commitments_nullifier_hash;

-- Cannot restore scrubbed wallet_address / plaintext nullifier values.
CREATE INDEX IF NOT EXISTS idx_commitments_nullifier ON proof_commitments(nullifier);
CREATE INDEX IF NOT EXISTS idx_commitments_wallet ON proof_commitments(wallet_address);
