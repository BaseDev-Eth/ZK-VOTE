export enum PriorityTier {
  CRITICAL = "CRITICAL",
  LOW = "LOW",
}

export interface TierSettings {
  concurrency: number;
  maxQueueWaitMs: number;
}

export const TIER_ORDER: readonly PriorityTier[] = [
  PriorityTier.CRITICAL,
  PriorityTier.LOW,
];

export const TIER_SETTINGS: Readonly<Record<PriorityTier, TierSettings>> = {
  [PriorityTier.CRITICAL]: {
    concurrency: 16,
    maxQueueWaitMs: 5_000,
  },
  [PriorityTier.LOW]: {
    concurrency: 4,
    maxQueueWaitMs: 30_000,
  },
};

/**
 * Express reports the path differently before and after a mounted router.
 * Normalize the public API prefixes so all three mounts receive identical
 * scheduling behavior.
 */
export function normalizePriorityPath(path: string): string {
  return path.replace(/^\/api\/v[12](?=\/|$)/, "") || "/";
}

export function classifyPriority(
  method: string,
  path: string,
): PriorityTier | null {
  if (method.toUpperCase() !== "POST") return null;

  const normalizedPath = normalizePriorityPath(path);
  if (/^\/vote(?:\/|$)/.test(normalizedPath)) {
    return PriorityTier.CRITICAL;
  }
  if (/^\/comments?(?:\/|$)/.test(normalizedPath)) {
    return PriorityTier.LOW;
  }
  return null;
}

export function isCriticalRequest(method: string, path: string): boolean {
  return classifyPriority(method, path) === PriorityTier.CRITICAL;
}
