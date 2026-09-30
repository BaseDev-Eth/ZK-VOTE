export interface TrustedAnchorSession {
  url: string;
  origin: string;
}

const DEFAULT_ANCHOR_ORIGINS = [
  "https://anchor.circle.com",
  "https://anchor.eurc.circle.com",
];

export function configuredAnchorOrigins(): ReadonlySet<string> {
  const configured = String(import.meta.env.VITE_ANCHOR_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : DEFAULT_ANCHOR_ORIGINS);
}

export function parseTrustedAnchorSession(
  payload: unknown,
  allowedOrigins: ReadonlySet<string> = configuredAnchorOrigins(),
): TrustedAnchorSession | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (
    typeof record.interactiveUrl !== "string" ||
    typeof record.interactiveOrigin !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(record.interactiveUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== record.interactiveOrigin ||
      !allowedOrigins.has(url.origin)
    ) {
      return null;
    }
    return { url: url.toString(), origin: url.origin };
  } catch {
    return null;
  }
}

const ALLOWED_MESSAGE_TYPES = new Set([
  "sep24:complete",
  "sep24:error",
  "sep24:close",
]);

export function isTrustedAnchorMessage(
  event: MessageEvent,
  frameWindow: Window | null,
  session: TrustedAnchorSession,
): boolean {
  if (event.source !== frameWindow || event.origin !== session.origin)
    return false;
  if (!event.data || typeof event.data !== "object") return false;
  return ALLOWED_MESSAGE_TYPES.has(
    (event.data as Record<string, unknown>).type as string,
  );
}
