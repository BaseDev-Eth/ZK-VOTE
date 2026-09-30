// @ts-nocheck
import { Router } from "express";
import {
  sendPayment,
  sendBatch,
  getTrustlineStatus,
  type PaymentAsset,
} from "../services/payments.js";
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

router.get("/pay/trustline", queryLimiter, async (req, res) => {
  const account = typeof req.query.account === "string" ? req.query.account : "";
  const asset = typeof req.query.asset === "string" ? req.query.asset : "";
  if (!account || !["XLM", "USDC", "EURC"].includes(asset)) {
    return res.status(400).json({ error: "account and valid asset are required" });
  }
  try {
    const status = await getTrustlineStatus(account, asset as PaymentAsset);
    return res.json(status);
  } catch (e: any) {
    log("warn", "trustline_preflight_error", {
      asset,
      error: e.message,
    });
    return res.status(502).json({ error: "Unable to verify destination trustline" });
  }
});

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
    const { asset, destination, amount, memo } = req.body;
    if (!asset || !destination || !amount)
      return res
        .status(400)
        .json({ error: "asset, destination, amount required" });
    const r = await sendPayment({ asset, destination, amount, memo });
    
    // Store idempotency result
    if (idempotencyKey) {
      paymentIdempotency.set(idempotencyKey, { hash: r.hash, timestamp: Date.now() });
    }
    
    res.json(r);
  } catch (e: any) {
    log("error", "pay_error", { error: e.message });
    const trustlineError = /trustline|issuer authorization/i.test(String(e.message));
    res.status(trustlineError ? 409 : 500).json({
      error: trustlineError ? e.message : "Payment failed",
    });
  }
});

router.post("/pay/batch", masterKeyGuard, csrfOriginGuard, bodyLimit("256kb"), paymentBatchCostLimiter, async (req, res) => {
  // Check idempotency key
  const idempotencyKey = req.header("Idempotency-Key");
  if (idempotencyKey) {
    const existing = paymentIdempotency.get(idempotencyKey);
    if (existing) {
      log("info", "batch_idempotent_hit", { idempotencyKey: idempotencyKey.slice(0, 16), hash: existing.hash });
      return res.status(200).json({ hash: existing.hash, idempotent: true });
    }
  }
  
  try {
    const { ops } = req.body;
    if (!Array.isArray(ops))
      return res.status(400).json({ error: "ops array required" });

    // Record ops per minute metric
    paymentOpsPerMinute.observe(ops.length);
    
    // Apply cost-based rate limiting
    const costFn = (req as any).rateLimit?.cost;
    if (costFn && costFn(ops.length)) {
      // Already sent 429 response
      return;
    }

    const headerTenant = req.headers["x-tenant-id"];
    const tenantId =
      typeof headerTenant === "string" &&
      /^[a-zA-Z0-9_-]{1,64}$/.test(headerTenant)
        ? headerTenant
        : "default";
    const r = await sendBatch(ops, tenantId);

    // Store idempotency result
    if (idempotencyKey) {
      paymentIdempotency.set(idempotencyKey, { hash: r.hash, timestamp: Date.now() });
    }

    res.json(r);
  } catch (e: any) {
    batch_partial_failure_total.inc({
      batch_type: "payments",
      reason: String(e.message || "unknown"),
    });
    res.status(500).json({ error: e.message });
  }
});

export default router;
