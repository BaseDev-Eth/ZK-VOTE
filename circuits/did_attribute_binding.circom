pragma circom 2.1.8;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Spike prototype for DID/eSIM-style signed claims without linking the claim
// to the voting membership commitment.
//
// ⚠️  CRITICAL SECURITY WARNING ⚠️
// This circuit is INCOMPLETE and INSECURE for production use.
// signedClaimHash and claimSalt are free private witnesses with NO cryptographic
// verification. A prover can generate unlimited fake attributes by:
//   1. Choosing arbitrary attributeValue (e.g., 10^9 to pass any threshold)
//   2. Grinding claimSalt to produce unused attributeNullifiers
//
// REQUIRED FIX: Add ECDSA/EdDSA signature verification proving that:
//   signedClaimHash = Hash(issuerId, attributeKey, attributeValue, ...)
//   AND the issuer's signature over signedClaimHash is valid
//
// Without signature verification, this circuit provides NO security guarantees.
// See circom-ecdsa or circom-eddsa libraries for signature verification templates.
//
// Public signals:
// - issuerId: field hash of the DID/eSIM issuer.
// - attributeKey: field hash for the disclosed attribute class.
// - minAttributeValue: threshold the holder must satisfy.
// - attributeNullifier: per-issuer/per-attribute uniqueness guard.
//
// Private signals:
// - signedClaimHash: field hash of the issuer-signed DID claim.
// - attributeValue: numeric claim attribute proved against the threshold.
// - claimSalt: holder-side salt used when hashing the claim context.
//
// This circuit deliberately does not take the ZKVote identity commitment,
// daoId, proposalId, or vote nullifier. The output nullifier is scoped only to
// the identity issuer/attribute flow, so it cannot be correlated with votes.
template DidAttributeBinding() {
    signal input issuerId;
    signal input attributeKey;
    signal input minAttributeValue;
    signal input attributeNullifier;

    signal input signedClaimHash;
    signal input attributeValue;
    signal input claimSalt;

    // TODO: Add signature verification inputs:
    // signal input issuerPubKey[2];      // ECDSA public key (x, y)
    // signal input signature[2];          // ECDSA signature (r, s)
    // signal input signedMessage;         // Message signed by issuer
    //
    // TODO: Verify signature:
    // component sigVerifier = ECDSAVerify();
    // sigVerifier.pubKey[0] <== issuerPubKey[0];
    // sigVerifier.pubKey[1] <== issuerPubKey[1];
    // sigVerifier.r <== signature[0];
    // sigVerifier.s <== signature[1];
    // sigVerifier.msghash <== signedClaimHash;
    // sigVerifier.result === 1;
    //
    // TODO: Link issuerPubKey to issuerId:
    // component issuerHasher = Poseidon(2);
    // issuerHasher.inputs[0] <== issuerPubKey[0];
    // issuerHasher.inputs[1] <== issuerPubKey[1];
    // issuerId === issuerHasher.out;

    component nullifierHasher = Poseidon(4);
    nullifierHasher.inputs[0] <== issuerId;
    nullifierHasher.inputs[1] <== attributeKey;
    nullifierHasher.inputs[2] <== signedClaimHash;
    nullifierHasher.inputs[3] <== claimSalt;
    attributeNullifier === nullifierHasher.out;

    component threshold = LessThan(64);
    threshold.in[0] <== minAttributeValue;
    threshold.in[1] <== attributeValue + 1;
    threshold.out === 1;
}

component main {public [issuerId, attributeKey, minAttributeValue, attributeNullifier]} = DidAttributeBinding();
