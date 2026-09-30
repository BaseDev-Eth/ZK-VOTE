import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeStellarAmount,
  formatStroops,
  parseStroops,
} from "../src/utils/stellarAmount.js";

describe("Stellar decimal amount conversion", () => {
  it("round-trips the one-stroop known-answer vector exactly", () => {
    assert.equal(parseStroops("0.0000001"), 1n);
    assert.equal(formatStroops(1n), "0.0000001");
    assert.equal(canonicalizeStellarAmount("10"), "10.0000000");
  });

  it("rejects precision beyond seven decimal places", () => {
    assert.throws(() => parseStroops("0.00000001"), /7 decimal places/);
    assert.throws(() => parseStroops("1e-7"), /7 decimal places/);
  });
});
