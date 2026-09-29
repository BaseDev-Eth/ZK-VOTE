/**
 * PostMessage origin security validation.
 * Protects against cross-origin postMessage attacks from malicious domains (e.g., evil.com).
 */

const TRUSTED_ORIGINS = [
  "https://api.soroswap.finance",
  "https://app.soroswap.finance",
  "https://soroswap.finance",
];

export type MessageScope = "swap" | "payment" | "ramp";

export function isAllowedMessageOrigin(
  origin: string,
  scope: MessageScope = "swap",
): boolean {
  if (!origin) return false;

  // Same-origin is always allowed for all scopes
  if (typeof window !== "undefined" && origin === window.location.origin) {
    return true;
  }

  // Payment and Ramp actions strictly require same-origin; never allow external origins
  if (scope === "payment" || scope === "ramp") {
    return false;
  }

  // For swap actions, allow configured Soroswap API origin or trusted Soroswap endpoints
  const soroswapApiUrl = (import.meta as any).env?.VITE_SOROSWAP_API;
  if (soroswapApiUrl) {
    try {
      const soroswapOrigin = new URL(soroswapApiUrl).origin;
      if (origin === soroswapOrigin) return true;
    } catch {
      // Ignore invalid URL
    }
  }

  if (TRUSTED_ORIGINS.includes(origin)) {
    return true;
  }

  return false;
}
