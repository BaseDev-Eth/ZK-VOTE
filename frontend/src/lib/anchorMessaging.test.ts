import { describe, expect, it } from "vitest";
import {
  isTrustedAnchorMessage,
  parseTrustedAnchorSession,
} from "./anchorMessaging";

describe("anchor messaging", () => {
  const session = {
    url: "https://anchor.circle.com/sep24/session/123",
    origin: "https://anchor.circle.com",
  };

  it("rejects interactive URLs outside the allowlist", () => {
    expect(
      parseTrustedAnchorSession(
        {
          interactiveUrl: "https://evil.example/steal",
          interactiveOrigin: "https://evil.example",
        },
        new Set(["https://anchor.circle.com"]),
      ),
    ).toBeNull();
  });

  it("accepts messages only from the exact iframe window and origin", () => {
    const frameWindow = {} as Window;
    const trusted = {
      source: frameWindow,
      origin: session.origin,
      data: { type: "sep24:complete" },
    } as MessageEvent;
    expect(isTrustedAnchorMessage(trusted, frameWindow, session)).toBe(true);
    expect(
      isTrustedAnchorMessage(
        { ...trusted, origin: "https://evil.example" } as MessageEvent,
        frameWindow,
        session,
      ),
    ).toBe(false);
    expect(
      isTrustedAnchorMessage(
        { ...trusted, data: { type: "run-script" } } as MessageEvent,
        frameWindow,
        session,
      ),
    ).toBe(false);
  });
});
