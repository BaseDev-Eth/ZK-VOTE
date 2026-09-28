// @ts-nocheck
import { Router } from "express";
import { getQuote, executeSwap } from "../services/swap.js";
import { queryLimiter, bodyLimit } from "../middleware/index.js";
import { swapQuoteQuerySchema, swapSubmitRequestSchema } from "../validation/schemas.js";

const router = Router();

router.get("/swap/quote", queryLimiter, async (req, res) => {
  try {
    // #597: same zod schemas as openapi.ts — keeps spec and runtime in sync.
    const parsed = swapQuoteQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "from, to, amount required" });
    }
    const { from, to, amount } = parsed.data as any;
    const q = await getQuote(from as any, to as any, amount as string);
    res.json(q);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/swap/submit", bodyLimit("5kb"), async (req, res) => {
  try {
    const parsed = swapSubmitRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || "from, to, amount required" });
    }
    const { from, to, amount, destMin, destination } = parsed.data as any;
    const dest = destination || (await import("../services/stellar.js")).relayerKeypair.publicKey();
    const r = await executeSwap(from, to, amount, destMin || "0", dest);
    res.json(r);
  } catch (e: any) {
    const status = /invalid destination|invalid amount|issuer not configured/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

export default router;
