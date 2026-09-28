import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";
import { getExplorerUrl } from "../src/utils/explorer.ts";
import { normalizeRoute, register, httpRequestsTotal } from "../src/services/metrics.ts";
import { redactSpanAttributes } from "../src/services/tracing.ts";

describe("Issues #555, #554, #551, #550 Regression Suite", () => {
  it("Issue #555: Secret placeholders in config instead of real keys", () => {
    assert.match(config.usdcIssuer, /^G[X0-9A-Z]{55}$/);
    assert.match(config.eurcIssuer, /^G[X0-9A-Z]{55}$/);
    assert.doesNotMatch(config.usdcIssuer, /^GDZRI/);
    assert.doesNotMatch(config.eurcIssuer, /^GAML/);
    if (config.relayerSecretKey) {
      assert.doesNotMatch(config.relayerSecretKey, /^SDKA/);
    }
  });

  it("Issue #554: Network-aware Stellar Expert link generation", () => {
    const txLink = getExplorerUrl("tx", "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
    assert.ok(txLink.includes("stellar.expert/explorer/"));
    assert.ok(txLink.includes("/tx/1234567890abcdef"));
  });

  it("Issue #551: Low-cardinality route normalization", () => {
    const route1 = normalizeRoute("/dao/12345?foo=bar");
    const route2 = normalizeRoute("/dao/67890?baz=qux");
    assert.equal(route1, "/dao/:param");
    assert.equal(route2, "/dao/:param");
    assert.equal(route1, route2);

    const addrRoute = normalizeRoute("/events/CCYQJ3RCWKJ4FQYI4QUXCWWQPLOXFZZW4YAZ5A4YQJ3V6UV7YP3AZ5TA");
    assert.equal(addrRoute, "/events/:param");
  });

  it("Issue #550: OTEL spanContext blindingFactor & PII redaction", () => {
    const rawAttributes = {
      blindingFactor: "12345678901234567890123456789012",
      relayer_secret: "SDKA7XBARYI524DTFUBWHP4PJ4WFNT6ASSYOY6E2Q6UKZLJG7MNEN2I6",
      daoId: 42,
    };
    const redacted = redactSpanAttributes(rawAttributes);
    assert.notEqual(redacted.blindingFactor, "12345678901234567890123456789012");
    assert.ok(String(redacted.blindingFactor).startsWith("sha256:"));
    assert.notEqual(redacted.relayer_secret, "SDKA7XBARYI524DTFUBWHP4PJ4WFNT6ASSYOY6E2Q6UKZLJG7MNEN2I6");
    assert.equal(redacted.daoId, 42);
  });
});
