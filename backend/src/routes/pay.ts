// @ts-nocheck
import { Router } from "express";
import { sendPayment, sendBatch } from "../services/payments.js";
import { bodyLimit, queryLimiter } from "../middleware/index.js";
import { log } from "../services/logger.js";

console.error("PAY ROUTES LOADED", new Date().toISOString());
log("info", "pay_routes_loaded", {});

const router = Router();

router.post("/pay", bodyLimit("5kb"), async (req, res) => {
  console.error("PAY HANDLER CALLED", JSON.stringify(req.body).slice(0,100));
  log("info", "pay_hit", { body: req.body });
  try {
    // #594/#597: single source of truth — same zod schemas as openapi.ts.
    const parsed = payRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "asset, destination (G.../M...), amount required" });
    }
    const { asset, destination, amount, memo } = parsed.data as any;
    const r = await sendPayment({ asset, destination, amount, memo });
    res.json(r);
  } catch (e: any) {
    console.error("PAY ERR", e.message, e.stack?.slice(0,500));
    const status = /invalid destination|invalid amount|issuer not configured/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

import { batch_partial_failure_total } from "../services/metrics.js";
import { payRequestSchema, payBatchRequestSchema } from "../validation/schemas.js";

router.post("/pay/batch", bodyLimit("256kb"), async (req, res) => {
  try {
    // #594/#597: validate all 1-100 ops (G.../M... + amount) before signing.
    const parsed = payBatchRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "ops array (1-100) required" });
    }
    const { ops } = parsed.data as any;
    const r = await sendBatch(ops);
    res.json(r);
  } catch (e: any) {
    batch_partial_failure_total.inc({ batch_type: "payments", reason: String(e.message || "unknown") });
    const status = /invalid destination|invalid amount|batch max|no ops|issuer not configured/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
