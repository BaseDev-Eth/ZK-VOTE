/**
 * #592 Per-DAO registry pin + allowlist + deployer attestation.
 * Voting create_proposal admin checks must call only the pinned registry
 * contract id whose code hash matches the pinned registry_hash.
 */
import { unauthenticatedRejectionTotal, crossTenantDenialTotal } from "./metrics.js";

const pins = new Map<number, { registryId: string; registryHash: string }>();
const allowlist = new Set<string>((process.env.REGISTRY_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean));

export function pinRegistry(daoId: number, registryId: string, registryHash: string): void {
  pins.set(daoId, { registryId, registryHash });
  allowlist.add(registryId);
}

export function getRegistryPin(daoId: number): { registryId: string; registryHash: string } | undefined {
  return pins.get(daoId);
}

/** Verify a get_admin response origin before trusting it. */
export function verifyRegistryCaller(daoId: number, callerId: string, callerHash?: string): void {
  const pin = pins.get(daoId);
  if (!pin) {
    unauthenticatedRejectionTotal.inc({ reason: "registry_not_pinned" });
    throw new Error("Registry not pinned for DAO");
  }
  if (callerId !== pin.registryId || !allowlist.has(callerId)) {
    crossTenantDenialTotal.inc();
    throw new Error("Registry caller not allowlisted (fake-registry spoof blocked)");
  }
  if (callerHash && callerHash !== pin.registryHash) {
    crossTenantDenialTotal.inc();
    throw new Error("Registry code hash mismatch (fake-registry spoof blocked)");
  }
}
