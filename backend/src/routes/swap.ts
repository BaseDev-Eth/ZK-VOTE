// @ts-nocheck
import { Router } from "express";
import { getQuote, executeSwap } from "../services/swap.js";
import { canonicalizeStellarAmount } from "../utils/stellarAmount.js";
import {
  queryLimiter,
  bodyLimit,
  csrfOriginGuard,
  masterKeyGuard,
} from "../middleware/index.js";
import { z } from "zod";

const router = Router();

const assetSchema = z.enum(["XLM", "USDC", "EURC"]);
const stellarAmountSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)(?:\.\d{1,7})?$/,
    "amount must use at most 7 decimal places",
  );
const positiveStellarAmountSchema = stellarAmountSchema.refine(
  (amount) => /[1-9]/.test(amount),
  "amount must be greater than zero",
);
const swapPairFields = {
  from: assetSchema,
  to: assetSchema,
  amount: positiveStellarAmountSchema,
};
const distinctAssets = ({ from, to }: { from: string; to: string }) =>
  from !== to;
const swapPairSchema = z.object(swapPairFields).refine(distinctAssets, {
  message: "from and to must be distinct assets",
});
const swapSubmitSchema = z
  .object({
    ...swapPairFields,
    destMin: stellarAmountSchema.optional(),
    destination: z.string().optional(),
  })
  .refine(distinctAssets, {
    message: "from and to must be distinct assets",
  });

router.get("/swap/quote", queryLimiter, async (req, res) => {
  const parsed = swapPairSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message });
  }
  try {
    const { from, to, amount } = parsed.data;
    const canonicalAmount = canonicalizeStellarAmount(String(amount));
    const q = await getQuote(from, to, canonicalAmount);
    res.json(q);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

router.post(
  "/swap/submit",
  masterKeyGuard,
  csrfOriginGuard,
  bodyLimit("5kb"),
  async (req, res) => {
    const parsed = swapSubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message });
    }
    try {
      const { from, to, amount, destMin, destination } = parsed.data;
      const canonicalAmount = canonicalizeStellarAmount(String(amount));
      const canonicalDestMin = canonicalizeStellarAmount(
        String(destMin ?? "0"),
        true,
      );
      const dest =
        destination ||
        (await import("../services/stellar.js")).relayerKeypair.publicKey();
      const r = await executeSwap(
        from,
        to,
        canonicalAmount,
        canonicalDestMin,
        dest,
      );
      res.json(r);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  },
);

export default router;
