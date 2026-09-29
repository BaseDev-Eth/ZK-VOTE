#!/usr/bin/env bash
# ==============================================================================
# Sigstore Cosign WASM Contract Signing Script
# Signs compiled WASM contracts (e.g. dao_registry.wasm) using sigstore / cosign.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WASM_DIR="${1:-$REPO_ROOT/target/wasm32v1-none/release}"

echo "=== ZKVote WASM Contract Sigstore Signing ==="

if [ ! -d "$WASM_DIR" ]; then
    echo "ERROR: Target WASM directory not found at $WASM_DIR." >&2
    echo "Please build contracts first: cargo build --target wasm32v1-none --release" >&2
    exit 1
fi

shopt -s nullglob
wasms=("$WASM_DIR"/*.wasm)
if [ ${#wasms[@]} -eq 0 ]; then
    echo "ERROR: No .wasm contract artifacts found in $WASM_DIR." >&2
    exit 1
fi

# Generate SHA256 checksums for all WASMs
CHECKSUM_FILE="$WASM_DIR/checksums.sha256"
echo "Generating SHA256 checksums in $CHECKSUM_FILE..."
(cd "$WASM_DIR" && sha256sum -- *.wasm > checksums.sha256)

if ! command -v cosign &> /dev/null; then
    echo "WARNING: 'cosign' command not installed. Checksums generated."
    exit 0
fi

for wasm in "${wasms[@]}"; do
    [ -f "$wasm" ] || continue
    echo "Signing $(basename "$wasm") with cosign..."
    if [ -n "${COSIGN_KEY:-}" ]; then
        cosign sign-blob --yes --key "$COSIGN_KEY" --output-signature "${wasm}.sig" "$wasm"
    else
        # Keyless signing via Sigstore OIDC: emit bundle or signature + certificate
        cosign sign-blob --yes --bundle "${wasm}.bundle" "$wasm" || \
        cosign sign-blob --yes --output-signature "${wasm}.sig" --output-certificate "${wasm}.cert" "$wasm" || {
            echo "ERROR: Failed to sign $(basename "$wasm") with cosign." >&2
            exit 1
        }
    fi
done

echo "✓ WASM signing complete."
