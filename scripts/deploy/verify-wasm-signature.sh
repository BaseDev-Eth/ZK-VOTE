#!/usr/bin/env bash
# ==============================================================================
# Sigstore Cosign WASM Signature & Integrity Verifier
# Prevents deploying unsigned or tampered WASM contracts (e.g. dao_registry.wasm).
# ==============================================================================

set -euo pipefail

WASM_FILE="${1:-}"

if [ -z "$WASM_FILE" ]; then
    echo "Usage: $0 <path-to-wasm-file>" >&2
    exit 1
fi

if [ ! -f "$WASM_FILE" ]; then
    echo "ERROR: WASM file not found: $WASM_FILE" >&2
    exit 1
fi

echo "Verifying WASM contract signature for $WASM_FILE..." >&2

# Allow explicit skip only when configured in dev/testing
if [ "${COSIGN_SKIP_VERIFY:-}" = "true" ]; then
    echo "WARNING: COSIGN_SKIP_VERIFY=true set; skipping cosign verification for $WASM_FILE" >&2
    exit 0
fi

SIG_FILE="${WASM_FILE}.sig"
CERT_FILE="${WASM_FILE}.cert"
BUNDLE_FILE="${WASM_FILE}.bundle"
CHECKSUM_FILE="$(dirname "$WASM_FILE")/checksums.sha256"

# Verify SHA256 integrity against checksum file if present
if [ -f "$CHECKSUM_FILE" ]; then
    WASM_BASENAME="$(basename "$WASM_FILE")"
    RECORDED_HASH=$(awk -v f="$WASM_BASENAME" '$2 == f {print $1}' "$CHECKSUM_FILE")
    if [ -n "$RECORDED_HASH" ]; then
        echo "Verifying SHA256 checksum against $CHECKSUM_FILE..." >&2
        CURRENT_HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')
        if [ "$CURRENT_HASH" != "$RECORDED_HASH" ]; then
            echo "ERROR: Hash mismatch for $WASM_FILE! Expected $RECORDED_HASH, got $CURRENT_HASH" >&2
            exit 1
        fi
        echo "✓ SHA256 checksum verified for $WASM_FILE" >&2
    fi
fi

# Cosign verification
if ! command -v cosign &> /dev/null; then
    echo "ERROR: cosign is not installed. Cryptographic contract verification requires cosign." >&2
    echo "Install cosign or set COSIGN_SKIP_VERIFY=true for offline local development." >&2
    exit 1
fi

COSIGN_PUBLIC_KEY="${COSIGN_PUBLIC_KEY:-cosign.pub}"
CERT_IDENTITY="${COSIGN_CERT_IDENTITY:-https://github.com/ZK-VOTE/.*}"
CERT_OIDC_ISSUER="${COSIGN_CERT_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"

if [ -f "$BUNDLE_FILE" ]; then
    echo "Verifying sigstore bundle for $WASM_FILE..." >&2
    cosign verify-blob \
        --bundle "$BUNDLE_FILE" \
        --certificate-identity-regexp "$CERT_IDENTITY" \
        --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
        "$WASM_FILE" >&2
    echo "✓ Sigstore bundle verified for $WASM_FILE" >&2
    exit 0
elif [ -f "$SIG_FILE" ]; then
    if [ -f "$CERT_FILE" ]; then
        echo "Verifying keyless signature and certificate for $WASM_FILE..." >&2
        cosign verify-blob \
            --signature "$SIG_FILE" \
            --certificate "$CERT_FILE" \
            --certificate-identity-regexp "$CERT_IDENTITY" \
            --certificate-oidc-issuer "$CERT_OIDC_ISSUER" \
            "$WASM_FILE" >&2
        echo "✓ Keyless signature verified for $WASM_FILE" >&2
        exit 0
    elif [ -f "$COSIGN_PUBLIC_KEY" ]; then
        echo "Verifying signature with public key $COSIGN_PUBLIC_KEY for $WASM_FILE..." >&2
        cosign verify-blob --key "$COSIGN_PUBLIC_KEY" --signature "$SIG_FILE" "$WASM_FILE" >&2
        echo "✓ Cosign signature verified for $WASM_FILE" >&2
        exit 0
    else
        echo "ERROR: Signature found at $SIG_FILE but no public key ($COSIGN_PUBLIC_KEY) or certificate ($CERT_FILE) provided." >&2
        exit 1
    fi
else
    echo "ERROR: Missing cosign signature for $WASM_FILE! Expected $SIG_FILE or $BUNDLE_FILE." >&2
    echo "Deploy blocked: refuses to deploy unverified WASM contract to Soroban network." >&2
    exit 1
fi
