-- ============================================
-- Migration 013: Privacy hardening for proof_commitments (#644)
-- ============================================
-- Stop retaining plaintext nullifiers and unverified wallet addresses that
-- join nullifier → wallet → proposal. Application writes store nullifier_hash
-- only; scrub historical linkage here.

ALTER TABLE proof_commitments ADD COLUMN nullifier_hash TEXT;

-- Scrub deanonymizing historical data (cannot safely hash in portable SQL)
UPDATE proof_commitments SET wallet_address = NULL;
UPDATE proof_commitments SET nullifier = '';

DROP INDEX IF EXISTS idx_commitments_wallet;
DROP INDEX IF EXISTS idx_commitments_nullifier;

CREATE INDEX IF NOT EXISTS idx_commitments_nullifier_hash
  ON proof_commitments(nullifier_hash);
