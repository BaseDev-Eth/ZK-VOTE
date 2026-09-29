import { describe, it, expect } from "vitest";
import { isAllowedMessageOrigin } from "./messageOrigin";

describe("isAllowedMessageOrigin", () => {
  it("blocks untrusted origins like evil.com", () => {
    expect(isAllowedMessageOrigin("https://evil.com")).toBe(false);
    expect(isAllowedMessageOrigin("http://attacker.org")).toBe(false);
    expect(isAllowedMessageOrigin("https://evil.soroswap.finance.attacker.com")).toBe(false);
  });

  it("blocks null or empty origins", () => {
    expect(isAllowedMessageOrigin("")).toBe(false);
    expect(isAllowedMessageOrigin(null as any)).toBe(false);
    expect(isAllowedMessageOrigin(undefined as any)).toBe(false);
  });

  it("allows trusted soroswap origins only for swap scope", () => {
    expect(isAllowedMessageOrigin("https://api.soroswap.finance", "swap")).toBe(true);
    expect(isAllowedMessageOrigin("https://app.soroswap.finance", "swap")).toBe(true);
    expect(isAllowedMessageOrigin("https://soroswap.finance", "swap")).toBe(true);
  });

  it("blocks external soroswap origins for payment and ramp scopes", () => {
    expect(isAllowedMessageOrigin("https://api.soroswap.finance", "payment")).toBe(false);
    expect(isAllowedMessageOrigin("https://app.soroswap.finance", "payment")).toBe(false);
    expect(isAllowedMessageOrigin("https://api.soroswap.finance", "ramp")).toBe(false);
    expect(isAllowedMessageOrigin("https://app.soroswap.finance", "ramp")).toBe(false);
  });
});
