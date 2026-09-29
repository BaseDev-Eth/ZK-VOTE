// @ts-nocheck
import { Router } from "express";
import { sendPayment, sendBatch } from "../services/payments.js";
import { bodyLimit, queryLimiter, csrfOriginGuard, paymentBatchCostLimiter, masterKeyGuard } from "../middleware/index.js";
import { log } from "../services/logger.js";
import { batch_partial_failure_total, paymentOpsPerMinute } from "../services/metrics.js";

log("info", "pay_routes_loaded", {});

// In-memory idempotency store (keyed by idempotency header)
const paymentIdempotency = new Map<string, { hash: string; timestamp: number }>();

// Clean up old entries every minute
setInterval(() => {
  const now = Date.now();
  const expired = [];
  for (const [key, value] of paymentIdempotency.entries()) {
    if (now - value.timestamp > 60000) { // 1 minute
      expired.push(key);
    }
  }
  for (const key of expired) {
    paymentIdempotency.delete(key);
  }
}, 60000);

const router = Router();

router.post("/pay", masterKeyGuard, csrfOriginGuard, bodyLimit("5kb"), async (req, res) => {
  log("info", "pay_hit", {});
  
  // Check idempotency key
  const idempotencyKey = req.header("Idempotency-Key");
  if (idempotencyKey) {
    const existing = paymentIdempotency.get(idempotencyKey);
    if (existing) {
      log("info", "payment_idempotent_hit", { idempotencyKey: idempotencyKey.slice(0, 16), hash: existing.hash });
      return res.status(200).json({ hash: existing.hash, idempotent: true });
    }
  }
  
  try {
    // #594/#597: single source of truth — same zod schemas as openapi.ts.
    const parsed = payRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "asset, destination (G.../M...), amount required" });
    }
    const { asset, destination, amount, memo } = parsed.data as any;
    const r = await sendPayment({ asset, destination, amount, memo });
    
    // Store idempotency result
    if (idempotencyKey) {
      paymentIdempotency.set(idempotencyKey, { hash: r.hash, timestamp: Date.now() });
    }
    
    res.json(r);
  } catch (e: any) {
    console.error("PAY ERR", e.message, e.stack?.slice(0,500));
    const status = /invalid destination|invalid amount|issuer not configured/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

import { batch_partial_failure_total } from "../services/metrics.js";
import { payRequestSchema, payBatchRequestSchema } from "../validation/schemas.js";

router.post("/pay/batch", csrfOriginGuard, bodyLimit("256kb"), async (req, res) => {
  try {
    // #594/#597: validate all 1-100 ops (G.../M... + amount) before signing.
    const parsed = payBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "ops array (1-100) required" });
    }
    const { ops } = parsed.data as any;
    const r = await sendBatch(ops);
    
    // Store idempotency result
    if (idempotencyKey) {
      paymentIdempotency.set(idempotencyKey, { hash: r.hash, timestamp: Date.now() });
    }
    
    res.json(r);
  } catch (e: any) {
    batch_partial_failure_total.inc({ batch_type: "payments", reason: String(e.message || "unknown") });
    const status = /invalid destination|invalid amount|batch max|no ops|issuer not configured/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
