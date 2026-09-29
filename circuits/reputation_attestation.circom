pragma circom 2.1.8;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Cross-DAO anonymous reputation portability prototype.
//
// ⚠️  CRITICAL SECURITY WARNING ⚠️
// This circuit is INCOMPLETE and INSECURE for production use.
// attestationCommitment, subjectSecret, score, attestationSalt, and revocationNonce
// are free private witnesses with NO cryptographic verification from the attester.
//
// EXPLOIT: A prover can:
//   1. Pick arbitrary score >= minScore
//   2. Grind revocationNonce to generate unlimited distinct reputationNullifiers
//   3. Use one honest attestationCommitment across infinite target DAOs
//
// REQUIRED FIX: Add signature verification proving the attester issued the reputation:
//   - Add attesterSignature and attesterPubKey inputs
//   - Verify ECDSA/EdDSA signature over (sourceDaoId, subjectSecret, score, attestationSalt)
//   - Link attesterPubKey to attesterKeyHash
//
// Without signature verification, reputation attestations are freely forgeable.
// See circom-ecdsa or circom-eddsa libraries for signature verification templates.
//
// The holder proves knowledge of an attester-issued reputation commitment and
// selectively discloses only that score >= minScore. The subject secret stays
// private and is never the same value used as a vote nullifier.
template ReputationAttestation() {
    signal input sourceDaoId;
    signal input targetDaoId;
    signal input attesterKeyHash;
    signal input minScore;
    signal input attestationCommitment;
    signal input reputationNullifier;

    signal input subjectSecret;
    signal input score;
    signal input attestationSalt;
    signal input revocationNonce;

    // TODO: Add signature verification inputs:
    // signal input attesterPubKey[2];    // ECDSA public key
    // signal input attesterSignature[2]; // ECDSA signature (r, s)
    //
    // TODO: Verify attester signature:
    // component sigVerifier = ECDSAVerify();
    // sigVerifier.pubKey[0] <== attesterPubKey[0];
    // sigVerifier.pubKey[1] <== attesterPubKey[1];
    // sigVerifier.r <== attesterSignature[0];
    // sigVerifier.s <== attesterSignature[1];
    // 
    // Compute message hash: Poseidon(sourceDaoId, subjectSecret, score, attestationSalt)
    // component messageHasher = Poseidon(4);
    // messageHasher.inputs[0] <== sourceDaoId;
    // messageHasher.inputs[1] <== subjectSecret;
    // messageHasher.inputs[2] <== score;
    // messageHasher.inputs[3] <== attestationSalt;
    // sigVerifier.msghash <== messageHasher.out;
    // sigVerifier.result === 1;
    //
    // TODO: Link attesterPubKey to attesterKeyHash:
    // component attesterHasher = Poseidon(2);
    // attesterHasher.inputs[0] <== attesterPubKey[0];
    // attesterHasher.inputs[1] <== attesterPubKey[1];
    // attesterKeyHash === attesterHasher.out;

    component commitmentHasher = Poseidon(5);
    commitmentHasher.inputs[0] <== sourceDaoId;
    commitmentHasher.inputs[1] <== attesterKeyHash;
    commitmentHasher.inputs[2] <== subjectSecret;
    commitmentHasher.inputs[3] <== score;
    commitmentHasher.inputs[4] <== attestationSalt;
    attestationCommitment === commitmentHasher.out;

    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== targetDaoId;
    nullifierHasher.inputs[1] <== attestationCommitment;
    nullifierHasher.inputs[2] <== subjectSecret;
    nullifierHasher.inputs[3] <== revocationNonce;
    reputationNullifier === nullifierHasher.out;

    component threshold = LessThan(64);
    threshold.in[0] <== minScore;
    threshold.in[1] <== score + 1;
    threshold.out === 1;
}

component main {public [sourceDaoId, targetDaoId, attesterKeyHash, minScore, attestationCommitment, reputationNullifier]} = ReputationAttestation();
