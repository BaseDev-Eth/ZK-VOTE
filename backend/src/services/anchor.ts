/**
 * Anchor Service — SEP-6/24/31 for USDC/EURC inflow/outflow (real, no mock)
 * Proxies to Circle/Tempo anchors; stores claimableBalance for pending
 */
import { log } from "./logger.js";
import { canonicalizeStellarAmount } from "../utils/stellarAmount.js";

const ANCHOR_USDC = process.env.ANCHOR_USDC_URL || "https://anchor.circle.com";
const ANCHOR_EURC =
  process.env.ANCHOR_EURC_URL || "https://anchor.eurc.circle.com";

export function anchorFor(asset: "USDC" | "EURC"): string {
  return asset === "USDC" ? ANCHOR_USDC : ANCHOR_EURC;
}

export function validateInteractiveUrl(
  value: unknown,
  asset: "USDC" | "EURC",
): string {
  if (typeof value !== "string")
    throw new Error("Anchor interactive URL is missing");
  const candidate = new URL(value);
  const configuredAnchor = new URL(anchorFor(asset));
  if (
    candidate.protocol !== "https:" ||
    candidate.origin !== configuredAnchor.origin ||
    candidate.username ||
    candidate.password
  ) {
    throw new Error("Anchor returned an untrusted interactive URL");
  }
  return candidate.toString();
}

export function sanitizeAnchorResponse(
  payload: unknown,
  asset: "USDC" | "EURC",
): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Anchor returned an invalid response");
  }
  const response = { ...(payload as Record<string, unknown>) };
  const rawInteractiveUrl =
    response.interactive_url ??
    (response.type === "interactive_customer_info_needed"
      ? response.url
      : undefined);
  if (rawInteractiveUrl !== undefined) {
    const interactiveUrl = validateInteractiveUrl(rawInteractiveUrl, asset);
    response.interactiveUrl = interactiveUrl;
    response.interactiveOrigin = new URL(interactiveUrl).origin;
    delete response.interactive_url;
    if (response.type === "interactive_customer_info_needed")
      delete response.url;
  }
  return response;
}

async function fetchAnchorJson(url: URL): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Anchor returned HTTP ${res.status}`);
  return res.json();
}

export async function sep6Deposit(
  asset: "USDC" | "EURC",
  account: string,
  amount: string,
) {
  const base = anchorFor(asset);
  const canonicalAmount = canonicalizeStellarAmount(amount);
  const url = new URL("/sep6/deposit", base);
  url.search = new URLSearchParams({
    asset,
    account,
    amount: canonicalAmount,
  }).toString();
  const response = sanitizeAnchorResponse(await fetchAnchorJson(url), asset);
  log("info", "anchor_deposit", {
    asset,
    account: account.slice(0, 8) + "...",
    amount: canonicalAmount,
  });
  return response;
}

export async function sep6Withdraw(
  asset: "USDC" | "EURC",
  account: string,
  amount: string,
  dest: string,
) {
  const base = anchorFor(asset);
  const canonicalAmount = canonicalizeStellarAmount(amount);
  const url = new URL("/sep6/withdraw", base);
  url.search = new URLSearchParams({
    asset,
    account,
    amount: canonicalAmount,
    dest,
  }).toString();
  const response = sanitizeAnchorResponse(await fetchAnchorJson(url), asset);
  log("info", "anchor_withdraw", {
    asset,
    account: account.slice(0, 8) + "...",
    amount: canonicalAmount,
  });
  return response;
}

export async function sep31Send(asset: "USDC" | "EURC", payload: any) {
  const base = anchorFor(asset);
  const res = await fetch(`${base}/sep31/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}
